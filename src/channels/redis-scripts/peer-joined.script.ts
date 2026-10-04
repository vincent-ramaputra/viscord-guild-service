/**
 * Applies an SFU peer_joined event to the voice state atomically. Redis runs the whole script before any
 * other command, so a leave check, mute update or second event can't interleave between the read and the writes.
 *
 * KEYS[1] voice:user:{userId}                  channelId the user is currently in voice in
 * KEYS[2] voice:state:{channelId}:{userId}     state for the channel being joined
 * KEYS[3] voice:channel:{channelId}            set of userIds in the channel being joined
 *
 * ARGV[1] userId
 * ARGV[2] channelId
 * ARGV[3] sessionId (the ticket jti)
 * ARGV[4] the new state as JSON (VoiceState with status 'connected')
 *
 * Returns { outcome, previousChannelId? }:
 *   'duplicate'    this session is already stored and connected (redelivered message), nothing changed
 *   'restored'     this session is stored but marked disconnected (the sweeper or a drop marked it while the
 *                  SFU still had the peer, seen again through sfu_snapshot); status set back to connected,
 *                  every other stored field (e.g. a newer mute state) kept, no broadcast needed
 *   'reconnected'  same channel, new session (reconnect within the grace period), no broadcast needed
 *   'moved'        user was in voice in previousChannelId; that state was removed, then the new one written
 *   'joined'       user was not in voice
 *
 * The 'moved' branch builds the old channel's keys from the value of KEYS[1] instead of receiving them in KEYS.
 * That works on a single Redis instance but not on Redis Cluster, where every key must be declared up front.
 */
export const PEER_JOINED_SCRIPT = `
local userKey = KEYS[1]
local stateKey = KEYS[2]
local channelKey = KEYS[3]

local userId = ARGV[1]
local channelId = ARGV[2]
local sessionId = ARGV[3]
local newState = ARGV[4]

local function writeNewState()
    redis.call('SET', stateKey, newState)
    redis.call('SADD', channelKey, userId)
    redis.call('SET', userKey, channelId)
end

local currentChannelId = redis.call('GET', userKey)

if currentChannelId == channelId then
    local raw = redis.call('GET', stateKey)
    if raw then
        local stored = cjson.decode(raw)
        if stored.sessionId == sessionId then
            if stored.status == 'connected' then
                return { 'duplicate' }
            end
            -- Same session, still on the SFU: undo the drop so its pending leave check finds it connected.
            stored.status = 'connected'
            redis.call('SET', stateKey, cjson.encode(stored))
            return { 'restored' }
        end
        writeNewState()
        return { 'reconnected' }
    end
    -- voice:user points here but the state is gone: treat it as a fresh join.
    writeNewState()
    return { 'joined' }
end

if currentChannelId then
    redis.call('DEL', 'voice:state:' .. currentChannelId .. ':' .. userId)
    redis.call('SREM', 'voice:channel:' .. currentChannelId, userId)
    writeNewState()
    return { 'moved', currentChannelId }
end

writeNewState()
return { 'joined' }
`;
