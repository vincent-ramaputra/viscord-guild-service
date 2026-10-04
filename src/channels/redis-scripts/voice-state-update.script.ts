/**
 * Applies a client's mute/deafen change to the stored voice state atomically. Only isMuted and isDeafened
 * change; every other field (sessionId, status, ...) is whatever is stored at that moment, so a reconnect or
 * leave that happens around the update can't be undone by it.
 *
 * KEYS[1] voice:state:{channelId}:{userId}
 *
 * ARGV[1] isMuted     'true' | 'false' | '' (empty: keep the stored value)
 * ARGV[2] isDeafened  'true' | 'false' | '' (empty: keep the stored value)
 * The client sends one field per toggle, so the update is partial (PATCH semantics).
 *
 * Returns { outcome, state? }:
 *   'stale'      no state (the user isn't in voice in this channel); nothing written
 *   'unchanged'  the given values are already stored; nothing written, no broadcast needed
 *   'updated'    state written; state is the new JSON for the broadcast
 */
export const VOICE_STATE_UPDATE_SCRIPT = `
local stateKey = KEYS[1]

local raw = redis.call('GET', stateKey)
if not raw then
    return { 'stale' }
end

local stored = cjson.decode(raw)
local isMuted = stored.isMuted
local isDeafened = stored.isDeafened
if ARGV[1] ~= '' then isMuted = ARGV[1] == 'true' end
if ARGV[2] ~= '' then isDeafened = ARGV[2] == 'true' end

if stored.isMuted == isMuted and stored.isDeafened == isDeafened then
    return { 'unchanged' }
end

stored.isMuted = isMuted
stored.isDeafened = isDeafened
local updated = cjson.encode(stored)
redis.call('SET', stateKey, updated)

return { 'updated', updated }
`;
