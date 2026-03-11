sub runTaskThread()
    videoId = m.top.videoId
    apiUrl  = m.top.apiUrl
    apiKey  = m.top.apiKey

    url = apiUrl + "/stream?id=" + videoId

    http = CreateObject("roUrlTransfer")
    http.SetUrl(url)
    http.AddHeader("X-API-Key", apiKey)
    http.SetCertificatesFile("common:/certs/ca-bundle.crt")
    http.InitClientCertificates()

    response = http.GetToString()

    if response = "" or response = invalid
        m.top.result = { error: "empty response", url: "", title: "" }
        return
    end if

    json = ParseJson(response)

    if json = invalid
        m.top.result = { error: "bad json", url: "", title: "" }
        return
    end if

    if json.error <> invalid
        m.top.result = { error: json.error, url: "", title: "" }
        return
    end if

    m.top.result = {
        error: "",
        url:   json.url,
        title: json.title
    }
end sub
