/**
 * Applies a peer_left event, or the delayed leave check after a drop, to the voice state atomically.
 * Every change is conditional on the stored sessionId, so a late event for an older session (the user has
 * since reconnected or moved) changes nothing.
 *
 * KEYS[1] voice:user:{userId}
 * KEYS[2] voice:state:{channelId}:{userId}
 * KEYS[3] voice:channel:{channelId}
 *
 * ARGV[1] userId
 * ARGV[2] channelId
 * ARGV[3] sessionId
 * ARGV[4] mode:
 *   'left'     voluntary leave: remove the state now
 *   'dropped'  connection lost: mark the state disconnected and keep it for the grace period
 *   'check'    grace period over: remove the state only if it is still disconnected
 *
 * Returns { outcome, remaining? }:
 *   'stale'    no state, or it belongs to another session (or, for 'check', it is connected again); nothing changed
 *   'marked'   ('dropped') status set to disconnected; no broadcast yet
 *   'removed'  state deleted; remaining is how many users are still in the channel
 */
export const PEER_LEFT_SCRIPT = `
local userKey = KEYS[1]
local stateKey = KEYS[2]
local channelKey = KEYS[3]

local userId = ARGV[1]
local channelId = ARGV[2]
local sessionId = ARGV[3]
local mode = ARGV[4]

if mode ~= 'left' and mode ~= 'dropped' and mode ~= 'check' then
    return redis.error_reply('peer-left: unknown mode ' .. tostring(mode))
end

local raw = redis.call('GET', stateKey)
if not raw then
    return { 'stale' }
end

local stored = cjson.decode(raw)
if stored.sessionId ~= sessionId then
    return { 'stale' }
end

if mode == 'dropped' then
    stored.status = 'disconnected'
    redis.call('SET', stateKey, cjson.encode(stored))
    return { 'marked' }
end

if mode == 'check' and stored.status ~= 'disconnected' then
    return { 'stale' }
end

redis.call('DEL', stateKey)
redis.call('SREM', channelKey, userId)
-- Only clear voice:user if it still points here; a join elsewhere may already have replaced it.
if redis.call('GET', userKey) == channelId then
    redis.call('DEL', userKey)
end

return { 'removed', redis.call('SCARD', channelKey) }
`;
