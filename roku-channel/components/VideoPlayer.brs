' ─────────────────────────────────────────────
' Monster Truck TV — VideoPlayer component
' ─────────────────────────────────────────────

' !! CHANGE THIS to your Saxa server IP/domain !!
const STREAM_API_URL = "http://96.126.106.225:3456"
const API_KEY        = "liam2026"

' Demo playlist — YouTube video IDs
const PLAYLIST = ["E6ZaFdwpFhk", "HdXYPGmzGlk", "G9eVF2jFHNY", "pM_GB5Sv02c", "_y2yXCWqTzg"]

sub init()
    m.currentIdx = 0
    m.video      = m.top.findNode("video")
    m.titleLabel = m.top.findNode("titleLabel")
    m.titleBg    = m.top.findNode("titleBg")
    m.loadingLabel = m.top.findNode("loadingLabel")

    m.video.observeField("state", "onVideoStateChange")
    m.top.setFocus(true)

    ' Start fetching first video
    fetchStream(PLAYLIST[m.currentIdx])
end sub

' ── Stream fetching (Task-based) ──────────────────────────────
sub fetchStream(videoId as String)
    m.loadingLabel.text   = "🚛 Loading..."
    m.loadingLabel.opacity = 1

    task = CreateObject("roSGNode", "StreamFetchTask")
    task.videoId  = videoId
    task.apiUrl   = STREAM_API_URL
    task.apiKey   = API_KEY
    task.observeField("result", "onStreamReady")
    task.control  = "RUN"
    m.fetchTask  = task
end sub

sub onStreamReady()
    result = m.fetchTask.result
    m.loadingLabel.opacity = 0

    if result.error <> invalid and result.error <> ""
        ' Skip broken video, try next
        m.currentIdx = (m.currentIdx + 1) mod PLAYLIST.count()
        fetchStream(PLAYLIST[m.currentIdx])
        return
    end if

    content = CreateObject("roSGNode", "ContentNode")
    content.url    = result.url
    content.title  = result.title

    m.video.content = content
    m.video.control = "play"

    ' Show title overlay for 3 seconds
    showTitle(result.title)
end sub

sub showTitle(title as String)
    m.titleLabel.text    = title
    m.titleLabel.opacity = 1
    m.titleBg.opacity    = 1

    ' Hide after 3 seconds using a timer
    timer = CreateObject("roSGNode", "Timer")
    timer.duration   = 3
    timer.repeat     = false
    timer.observeField("fire", "hideTitle")
    timer.control    = "start"
    m.titleTimer     = timer
end sub

sub hideTitle()
    m.titleLabel.opacity = 0
    m.titleBg.opacity    = 0
end sub

' ── Video state ───────────────────────────────────────────────
sub onVideoStateChange()
    state = m.video.state
    m.top.state = state

    if state = "finished"
        playNext()
    else if state = "error"
        ' Skip on error
        playNext()
    end if
end sub

sub playNext()
    m.currentIdx = (m.currentIdx + 1) mod PLAYLIST.count()
    fetchStream(PLAYLIST[m.currentIdx])
end sub

sub playPrev()
    m.currentIdx = (m.currentIdx - 1 + PLAYLIST.count()) mod PLAYLIST.count()
    fetchStream(PLAYLIST[m.currentIdx])
end sub

' ── Remote control ───────────────────────────────────────────
function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false

    if key = "right" or key = "fastforward"
        playNext()
        return true
    else if key = "left" or key = "rewind"
        playPrev()
        return true
    else if key = "play" or key = "OK"
        if m.video.state = "playing"
            m.video.control = "pause"
        else
            m.video.control = "play"
        end if
        return true
    end if

    return false
end function

' ── Control field handler ────────────────────────────────────
sub onControlChange()
    if m.top.control = "play"
        if m.video.content = invalid
            fetchStream(PLAYLIST[m.currentIdx])
        else
            m.video.control = "play"
        end if
    else if m.top.control = "stop"
        m.video.control = "stop"
    end if
end sub
