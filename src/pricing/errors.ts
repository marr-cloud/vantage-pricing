/** Error esperado cuyo mensaje se puede mostrar tal cual al agente. */
export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidInputError extends PricingError {}
export class NotFoundError extends PricingError {}
export class UpstreamError extends PricingError {}
