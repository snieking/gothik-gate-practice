-- Public read APIs and optional secure posthooks only. This addon never calls
-- movement functions, changes bindings, sends messages, or reads other players.
local SCHEMA = "gothik-era-recording-v1"
local PERIOD = 1 / 60
local MAX_SAMPLES, MAX_EVENTS = 7400, 8192
local frame = CreateFrame("Frame")
local current, startedAt, nextSample, bindings, lastInputs, exportFrame
local hookState, hooks = {}, {}
local actions = {
    { key = "forward", binding = "MOVEFORWARD", start = "MoveForwardStart", stop = "MoveForwardStop" },
    { key = "backward", binding = "MOVEBACKWARD", start = "MoveBackwardStart", stop = "MoveBackwardStop" },
    { key = "strafeLeft", binding = "STRAFELEFT", start = "StrafeLeftStart", stop = "StrafeLeftStop" },
    { key = "strafeRight", binding = "STRAFERIGHT", start = "StrafeRightStart", stop = "StrafeRightStop" },
    { key = "turnLeft", binding = "TURNLEFT", start = "TurnLeftStart", stop = "TurnLeftStop" },
    { key = "turnRight", binding = "TURNRIGHT", start = "TurnRightStart", stop = "TurnRightStop" },
}
local cases = {
    idle = true, standing = true, running = true, wall = true, manual = true,
    ["speed-base"] = true, ["speed-zanza"] = true,
    ["speed-cheetah"] = true, ["speed-both"] = true,
}

local function read(name, ...)
    local fn = _G[name]
    if type(fn) ~= "function" then return false end
    return pcall(fn, ...)
end

local function isSecret(value)
    if type(_G.issecretvalue) ~= "function" then return false end
    local ok, result = pcall(_G.issecretvalue, value)
    return not ok or result == true
end

local function number(value)
    if isSecret(value) or type(value) ~= "number" then return nil end
    if value ~= value or value == math.huge or value == -math.huge then return nil end
    return value
end

local function boolean(value)
    if isSecret(value) then return nil end
    if type(value) == "boolean" then return value end
    if value == 1 then return true end
    if value == 0 then return false end
    return nil
end

local function clock()
    local ok, t = read("GetTimePreciseSec")
    if ok and number(t) then return t, "GetTimePreciseSec" end
    ok, t = read("GetTime")
    if ok and number(t) then return t, "GetTime" end
    return nil, "unavailable"
end

local function notify(message)
    print("Gothik recorder: " .. message)
end

local function database()
    if type(GothikMovementRecorderDB) ~= "table" then
        GothikMovementRecorderDB = { schema = SCHEMA, sessions = {} }
    end
    if type(GothikMovementRecorderDB.sessions) ~= "table" then
        GothikMovementRecorderDB.sessions = {}
    end
    while #GothikMovementRecorderDB.sessions > 3 do
        table.remove(GothikMovementRecorderDB.sessions, 1)
    end
    return GothikMovementRecorderDB
end

local function event(kind, details)
    if not current then return end
    if #current.events >= MAX_EVENTS then
        current.capture.eventsTruncated = true
        return
    end
    local t = clock()
    if not t then return end
    local item = { t = math.max(0, t - startedAt), kind = kind }
    for key, value in pairs(details or {}) do item[key] = value end
    current.events[#current.events + 1] = item
end

local function installHook(name, callback)
    if type(_G[name]) ~= "function" or type(_G.hooksecurefunc) ~= "function" then
        hooks[name] = false
        return
    end
    hooks[name] = pcall(_G.hooksecurefunc, name, callback)
end

for _, action in ipairs(actions) do
    local key = action.key
    installHook(action.start, function()
        hookState[key] = true
        event("key", { action = key, down = true, source = "posthook" })
    end)
    installHook(action.stop, function()
        hookState[key] = false
        event("key", { action = key, down = false, source = "posthook" })
    end)
end
installHook("JumpOrAscendStart", function()
    -- This is a manual jump request, not proof that the character took off.
    event("jump", { source = "posthook" })
end)
installHook("ToggleAutoRun", function()
    event("key", { action = "autorun", source = "posthook" })
end)
installHook("MoveAndSteerStart", function()
    hookState.mouseForward = true
    event("key", { action = "mouseForward", down = true, source = "posthook" })
end)
installHook("MoveAndSteerStop", function()
    hookState.mouseForward = false
    event("key", { action = "mouseForward", down = false, source = "posthook" })
end)

local function refreshBindings()
    bindings = {}
    for _, action in ipairs(actions) do
        local ok, a, b = read("GetBindingKey", action.binding)
        bindings[action.key] = { available = ok, a = a, b = b }
    end
    local ok, a, b = read("GetBindingKey", "JUMP")
    bindings.jump = { available = ok, a = a, b = b }
end

local function held(binding)
    if type(binding) ~= "string" or binding == "" then return false end
    local modifiers = {
        { "SHIFT%-", "IsShiftKeyDown" },
        { "CTRL%-", "IsControlKeyDown" },
        { "ALT%-", "IsAltKeyDown" },
    }
    for _, modifier in ipairs(modifiers) do
        if binding:find(modifier[1]) then
            local ok, value = read(modifier[2])
            if ok then value = boolean(value) else value = nil end
            if value == nil then return nil end
            if not value then return false end
        end
    end
    local base = binding:gsub("SHIFT%-", ""):gsub("CTRL%-", ""):gsub("ALT%-", "")
    local mouseIndex = tonumber(base:match("^BUTTON(%d+)$"))
    local ok, value
    if mouseIndex then
        local mouseNames = { "LeftButton", "RightButton", "MiddleButton" }
        ok, value = read("IsMouseButtonDown", mouseNames[mouseIndex] or "Button" .. mouseIndex)
    else
        ok, value = read("IsKeyDown", base)
    end
    if not ok then return nil end
    return boolean(value)
end

local function bindingHeld(key)
    local binding = bindings[key]
    if not binding or not binding.available then return nil end
    local a, b = held(binding.a), held(binding.b)
    if a == true or b == true then return true end
    if a == nil or b == nil then return nil end
    return false
end

local function inputs()
    local result = {}
    local _, focus = read("GetCurrentKeyBoardFocus")
    for _, action in ipairs(actions) do
        local key = action.key
        local polled
        if focus then polled = false else polled = bindingHeld(key) end
        if polled == nil then polled = hookState[key] end
        -- Posthooks also observe mouse-bound movement requests.
        if hookState[key] == true then polled = true end
        result[key] = polled
    end
    local leftOK, left = read("IsMouseButtonDown", "LeftButton")
    local rightOK, right = read("IsMouseButtonDown", "RightButton")
    if leftOK then left = boolean(left) else left = nil end
    if rightOK then right = boolean(right) else right = nil end
    if left == true and right == true then result.forward = true end
    if hookState.mouseForward == true then result.forward = true end
    result.mouseLeft, result.mouseRight = left, right
    return result
end

local function sample(t)
    if not current or #current.samples >= MAX_SAMPLES then return end
    local item = { t = math.max(0, t - startedAt), inputs = inputs() }
    local ok, x, y, z, mapId = read("UnitPosition", "player")
    if ok then
        -- Preserve API return order. Never replace missing coordinates with zero.
        item.x, item.y, item.z, item.mapId = number(x), number(y), number(z), number(mapId)
    end
    if item.x and item.y and item.z and item.mapId then
        current.coordinateAvailability = true
        current.capture.coordinateSamples = current.capture.coordinateSamples + 1
        current.coordinateNote = "Raw UnitPosition returns 1, 2, 3, 4 are x, y, z, mapId. Check coordinate order against a known position before scene alignment. Individual samples may omit unavailable coordinates."
    end
    ok, x = read("GetPlayerFacing")
    if ok then item.facing = number(x) end
    ok, x = read("GetUnitSpeed", "player")
    if ok then item.speed = number(x) end
    ok, x = read("IsFalling")
    if ok then item.falling = boolean(x) end
    current.samples[#current.samples + 1] = item
    if lastInputs then
        for key, value in pairs(item.inputs) do
            if value ~= lastInputs[key] then
                event("key", { action = key, down = value, source = "binding-poll" })
            end
        end
    end
    if not hooks.JumpOrAscendStart then
        local jump = bindingHeld("jump")
        if jump == true and not current.capture.jumpWasHeld then
            event("jump", { source = "binding-poll" })
        end
        current.capture.jumpWasHeld = jump
    end
    lastInputs = item.inputs
end

local function stop(reason)
    if not current then return end
    local t = clock()
    if t then
        local previous = current.samples[#current.samples]
        if not previous or t - startedAt > previous.t + 0.001 then sample(t) end
        current.capture.duration = math.max(0, t - startedAt)
    end
    event("recording", { state = "stop", reason = reason or "manual" })
    current.capture.stopReason = reason or "manual"
    current.capture.jumpWasHeld = nil
    local count, coordinates = #current.samples, current.capture.coordinateSamples
    current, lastInputs = nil, nil
    frame:SetScript("OnUpdate", nil)
    notify("Stopped. " .. count .. " samples, " .. coordinates .. " with coordinates. /gothikrecord export opens JSON.")
end

local function start(seconds, caseId)
    stop("restarted")
    local t, clockName = clock()
    if not t then notify("No readable game clock is available.") return end
    seconds = math.max(1, math.min(120, tonumber(seconds) or 60))
    refreshBindings()
    local buildOK, version, build, _, interface = read("GetBuildInfo")
    if not buildOK then version, build, interface = nil, nil, nil end
    local _, _, race = read("UnitRace", "player")
    local _, sex = read("UnitSex", "player")
    local _, fps = read("GetFramerate")
    current = {
        schema = SCHEMA,
        client = { version = version, build = tonumber(build) or build, interface = number(interface) },
        player = { race = race, sex = number(sex) },
        coordinateAvailability = false,
        coordinateNote = "UnitPosition has not returned a complete numeric position. Missing coordinates are omitted; this recording may support timing and reported speed only.",
        capture = {
            clock = clockName, targetHz = 60, maximumDuration = seconds,
            fpsAtStart = number(fps),
            caseId = cases[caseId] and caseId or "manual",
            coordinateSamples = 0,
            inputNote = "Directional intent from current binding key polls and optional secure posthooks. It is not actual movement velocity. Missing fields mean unavailable. Autorun is recorded as an event without guessing its state.",
            hooks = {},
        },
        samples = {}, events = {},
    }
    for name, available in pairs(hooks) do current.capture.hooks[name] = available end
    startedAt, nextSample, lastInputs = t, t + PERIOD, nil
    local sessions = database().sessions
    sessions[#sessions + 1] = current
    while #sessions > 3 do table.remove(sessions, 1) end
    event("recording", { state = "start" })
    sample(t)
    frame:SetScript("OnUpdate", function()
        local tick = clock()
        if not tick then stop("clock-unavailable") return end
        if tick - startedAt >= current.capture.maximumDuration or #current.samples >= MAX_SAMPLES then
            stop("complete")
            return
        end
        if tick >= nextSample then
            sample(tick)
            -- One actual sample per rendered frame. Never invent catch-up samples.
            nextSample = nextSample + PERIOD
            if nextSample <= tick then nextSample = tick + PERIOD end
        end
    end)
    notify("Recording up to " .. seconds .. " seconds at 60 Hz when FPS allows. Move manually. /gothikrecord stop ends early.")
end

local function quote(value)
    local escapes = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
    return '"' .. value:gsub('[%z\1-\31\\"]', function(char)
        return escapes[char] or string.format("\\u%04x", string.byte(char))
    end) .. '"'
end

local function json(value, forceArray)
    local kind = type(value)
    if kind == "nil" then return "null" end
    if kind == "boolean" then return value and "true" or "false" end
    if kind == "string" then return quote(value) end
    if kind == "number" then return number(value) and string.format("%.17g", value) or "null" end
    if kind ~= "table" then return "null" end
    local array, count = forceArray or #value > 0, 0
    for key in pairs(value) do
        count = count + 1
        if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then array = false end
    end
    local parts = {}
    if array and count == #value then
        for i = 1, #value do parts[#parts + 1] = json(value[i]) end
        return "[" .. table.concat(parts, ",") .. "]"
    end
    local keys = {}
    for key in pairs(value) do if type(key) == "string" then keys[#keys + 1] = key end end
    table.sort(keys)
    for _, key in ipairs(keys) do
        parts[#parts + 1] = quote(key) .. ":" .. json(value[key], key == "samples" or key == "events")
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

local function export(index)
    stop("export")
    local sessions = database().sessions
    local recording = sessions[index or #sessions]
    if not recording then notify("Record first with /gothikrecord start 10 idle.") return end
    if not exportFrame then
        local ui = CreateFrame("Frame", "GothikMovementRecorderExport", UIParent)
        ui:SetSize(660, 460)
        ui:SetPoint("CENTER")
        ui:SetFrameStrata("DIALOG")
        ui:EnableMouse(true)
        ui:SetMovable(true)
        ui:RegisterForDrag("LeftButton")
        ui:SetScript("OnDragStart", ui.StartMoving)
        ui:SetScript("OnDragStop", ui.StopMovingOrSizing)
        local background = ui:CreateTexture(nil, "BACKGROUND")
        background:SetAllPoints()
        background:SetColorTexture(0.04, 0.04, 0.06, 0.98)
        local title = ui:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
        title:SetPoint("TOPLEFT", 18, -16)
        title:SetText("Gothik movement recording")
        local explanation = ui:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
        explanation:SetPoint("TOPLEFT", 18, -44)
        explanation:SetText("Copy the selected JSON with Ctrl+C or Cmd+C. It contains no character name, account, or chat.")
        local close = CreateFrame("Button", nil, ui, "UIPanelCloseButton")
        close:SetPoint("TOPRIGHT", -2, -2)
        close:SetScript("OnClick", function() ui:Hide() end)
        local scroll = CreateFrame("ScrollFrame", nil, ui, "UIPanelScrollFrameTemplate")
        scroll:SetPoint("TOPLEFT", 18, -72)
        scroll:SetPoint("BOTTOMRIGHT", -36, 34)
        local edit = CreateFrame("EditBox", nil, scroll)
        edit:SetWidth(600)
        edit:SetHeight(354)
        edit:SetMultiLine(true)
        edit:SetMaxLetters(0)
        edit:SetAutoFocus(false)
        edit:SetFontObject(ChatFontNormal or GameFontHighlightSmall)
        edit:SetScript("OnEscapePressed", function(self) self:ClearFocus() ui:Hide() end)
        scroll:SetScrollChild(edit)
        ui.edit, ui.scroll = edit, scroll
        ui:SetScript("OnHide", function() edit:ClearFocus() end)
        exportFrame = ui
    end
    local text = json(recording)
    exportFrame:Show()
    exportFrame.edit:SetText(text)
    exportFrame.edit:SetHeight(math.max(354, math.ceil(#text / 75) * 14))
    exportFrame.scroll:SetVerticalScroll(0)
    exportFrame.edit:SetFocus()
    exportFrame.edit:HighlightText()
end

local gameEvents = {
    "PLAYER_STARTED_MOVING", "PLAYER_STOPPED_MOVING",
    "PLAYER_STARTED_TURNING", "PLAYER_STOPPED_TURNING",
    "GLOBAL_MOUSE_DOWN", "GLOBAL_MOUSE_UP",
}
for _, name in ipairs(gameEvents) do pcall(frame.RegisterEvent, frame, name) end
pcall(frame.RegisterEvent, frame, "UPDATE_BINDINGS")
pcall(frame.RegisterEvent, frame, "PLAYER_LOGOUT")
frame:SetScript("OnEvent", function(_, name, arg1)
    if name == "UPDATE_BINDINGS" then
        if current then refreshBindings() event("bindings", { state = "updated" }) end
    elseif name == "PLAYER_LOGOUT" then
        stop("logout")
    elseif name == "GLOBAL_MOUSE_DOWN" or name == "GLOBAL_MOUSE_UP" then
        event("key", {
            action = type(arg1) == "string" and arg1 or "mouse",
            down = name == "GLOBAL_MOUSE_DOWN", source = "game-event",
        })
    else
        event("movement", { event = name })
    end
end)

SLASH_GOTHIKMOVEMENTRECORDER1 = "/gothikrecord"
SlashCmdList.GOTHIKMOVEMENTRECORDER = function(message)
    local command, rest = (message or ""):match("^%s*(%S*)%s*(.-)%s*$")
    if command == "start" then
        local seconds, caseId = rest:match("^(%d*)%s*(.-)$")
        start(tonumber(seconds) or 60, caseId)
    elseif command == "stop" then
        stop("manual")
    elseif command == "export" then
        export(tonumber(rest))
    elseif command == "status" then
        notify((current and "Recording. " or "Idle. ") .. #database().sessions .. " sessions saved in memory. Only the last 3 are retained.")
    else
        notify("/gothikrecord start 10 idle | stop | export [1-3] | status. Default 60 seconds, maximum 120.")
    end
end
