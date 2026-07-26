export interface Span {
    end(): void;

    setAttribute(key: string, value: string | number | boolean): void;

    addEvent(name: string, attributes?: Record<string, unknown>): void;

    recordException(error: unknown): void;

    setStatus(status: 'ok' | 'error'): void;
}

class NoopSpan implements Span {
    constructor(
        private readonly name: string,
        private readonly attributes: Record<string, string | number | boolean>,
    ) {}

    end(): void {
        void this.name;
        void this.attributes;
    }

    setAttribute(_key: string, _value: string | number | boolean): void {
        // noop
    }

    addEvent(_name: string, _attributes?: Record<string, unknown>): void {
        // noop
    }

    recordException(_error: unknown): void {
        // noop
    }

    setStatus(_status: 'ok' | 'error'): void {
        // noop
    }
}

export function startSpan(
    name: string,
    attributes: Record<string, string | number | boolean> = {},
): Span {
    return new NoopSpan(name, attributes);
}
