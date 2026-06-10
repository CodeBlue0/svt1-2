const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RoundAnalysisPayload = {
  round?: number | string;
  text?: string;
};

type AnalysisPayload = {
  participantName?: string;
  experiment?: string;
  chart?: string;
  roundAnalyses?: RoundAnalysisPayload[];
  promptInstruction?: string;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function cleanText(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function buildPrompt(payload: AnalysisPayload) {
  const participantName = cleanText(payload.participantName, "참여자");
  const experiment = cleanText(payload.experiment, "SVT");
  const chart = cleanText(payload.chart, "RT x accuracy");
  const roundAnalyses = (Array.isArray(payload.roundAnalyses) ? payload.roundAnalyses : [])
    .slice(0, 9)
    .map((point) => ({
      round: point.round,
      text: cleanText(point.text, ""),
    }))
    .filter((point) => point.round !== undefined && point.text);

  if (!roundAnalyses.length) {
    throw new Error("종합할 1~9회차 텍스트 분석이 없습니다.");
  }

  return [
    `참여자: ${participantName}`,
    `실험: ${experiment}`,
    `그래프: ${chart}`,
    "회차별 텍스트 분석:",
    ...roundAnalyses.map((point) => `${point.round}회차: ${point.text}`),
    "",
    cleanText(
      payload.promptInstruction,
      "1~9회차별 텍스트 분석을 입력으로 삼아 전체 흐름을 한국어로 종합하세요. 개별 값이나 수치 나열보다 초반-중반-후반의 변화, 추세, 안정성, 반응속도와 정확도 사이의 균형에 더 집중하세요. 평균 대비 특징도 단순 비교보다 흐름 속 의미를 중심으로 설명하고, 숫자를 새로 계산하지 마세요. 3~5문장으로 담백하게 작성하세요.",
    ),
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "POST 요청만 지원합니다." }, 405);
  }

  const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
  if (!apiKey) {
    return jsonResponse({ error: "DEEPSEEK_API_KEY가 Supabase Edge Function secrets에 설정되지 않았습니다." }, 500);
  }

  let payload: AnalysisPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "요청 본문을 JSON으로 읽을 수 없습니다." }, 400);
  }

  let prompt: string;
  try {
    prompt = buildPrompt(payload);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "분석 입력이 올바르지 않습니다." }, 400);
  }

  const deepseekResponse = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("DEEPSEEK_MODEL") || "deepseek-v4-flash",
      messages: [
        {
          role: "system",
          content: "당신은 인지 실험 결과를 담백하고 조심스럽게 설명하는 한국어 데이터 분석가입니다. 진단이나 의학적 판단은 하지 말고 관찰 가능한 흐름만 설명하세요.",
        },
        { role: "user", content: prompt },
      ],
      stream: false,
      temperature: 0.3,
    }),
  });

  const deepseekData = await deepseekResponse.json().catch(() => ({}));

  if (!deepseekResponse.ok) {
    const message = typeof deepseekData?.error?.message === "string"
      ? deepseekData.error.message
      : "DeepSeek API 요청에 실패했습니다.";
    return jsonResponse({ error: message }, deepseekResponse.status);
  }

  const analysis = deepseekData?.choices?.[0]?.message?.content;
  if (typeof analysis !== "string" || !analysis.trim()) {
    return jsonResponse({ error: "DeepSeek 분석 응답이 비어 있습니다." }, 502);
  }

  return jsonResponse({ analysis: analysis.trim() });
});
