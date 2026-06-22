export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Pick<Response, "ok" | "status" | "json" | "text" | "headers">>;

export function defaultFetch(): FetchLike {
  return fetch;
}

export async function readJson(response: Pick<Response, "json" | "text">): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    const text = await response.text().catch(() => "");
    return { rawText: text };
  }
}
