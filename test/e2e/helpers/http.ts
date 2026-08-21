const BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3002';

export async function http<T>(
    path: string,
    options: RequestInit = {},
): Promise<{
    status: number;
    body: T;
}> {
    const response = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers: {
            'content-type': 'application/json',
            ...(options.headers ?? {}),
        },
    });

    const text = await response.text();

    let body: T;

    try {
        body = JSON.parse(text) as T;
    } catch {
        throw new Error(`Invalid JSON response (${response.status}): ${text}`);
    }

    return {
        status: response.status,
        body,
    };
}
