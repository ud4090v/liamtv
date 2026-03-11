sub init()
    m.videoPlayer = m.top.findNode("videoPlayer")
    m.videoPlayer.observeField("state", "onPlayerStateChange")
    m.videoPlayer.setFocus(true)
    m.videoPlayer.control = "play"
end sub

sub onPlayerStateChange()
    ' Player handles its own next/prev logic
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if press then
        if key = "back"
            m.videoPlayer.control = "stop"
            return true
        end if
    end if
    return false
end function
