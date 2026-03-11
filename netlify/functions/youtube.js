exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "YOUTUBE_API_KEY not set in Netlify environment variables" })
    };
  }

  try {
    // Forward all query params from the request, injecting the real API key
    const params = new URLSearchParams(event.queryStringParameters || {});
    params.set("key", apiKey);

    const endpoint = event.queryStringParameters?.endpoint || "search";
    const url = `https://www.googleapis.com/youtube/v3/${endpoint}?${params.toString()}`;

    const response = await fetch(url);
    const data = await response.json();

    return {
      statusCode: response.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
