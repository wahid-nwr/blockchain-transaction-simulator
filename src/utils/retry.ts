export async function retry<T>(
    fn: () => Promise<T>,
    options: {
        retries: number;
        delay: number;
        factor?: number;
    },
) {
    const factor = options.factor ?? 2;

    let attempt = 0;
    let delay = options.delay;

    while (true) {
        try {
            return await fn();
        } catch (error) {
            if (attempt >= options.retries) {
                throw error;
            }

            await new Promise((resolve) => setTimeout(resolve, delay));

            delay *= factor;
            attempt++;
        }
    }
}
