export class GeoAdapterError extends Error {
  constructor(message, status = 400, code = 'geo_adapter_error', detail = undefined) {
    super(message);
    this.name = 'GeoAdapterError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}
