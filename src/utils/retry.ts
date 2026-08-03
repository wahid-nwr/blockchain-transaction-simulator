export interface RetryOptions {
    retries: number;
    delay: number;
    factor?: number;
    onRetry?: (error: unknown, attempt: number, nextDelay: number) => void;
}

export async function retry<T>(
    fn: () => Promise<T>,
    options: RetryOptions,
    shouldRetry: (error: unknown) => boolean = () => true,
): Promise<T> {
    const factor = options.factor ?? 2;

    let attempt = 0;
    let delay = options.delay;

    while (true) {
        try {
            return await fn();
        } catch (error) {
            if (!shouldRetry(error) || attempt >= options.retries) {
                throw error;
            }

            const nextDelay = delay;

            attempt++;

            options.onRetry?.(error, attempt, nextDelay);

            await sleep(nextDelay);

            delay *= factor;
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
