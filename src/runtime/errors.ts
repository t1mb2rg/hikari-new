export class RuntimeError extends Error {}

export class DuplicatePluginError extends RuntimeError {
  constructor(pluginId: string) {
    super(`Plugin already loaded: ${pluginId}`);
  }
}

export class ServiceAlreadyProvidedError extends RuntimeError {
  constructor(serviceId: string, ownerId: string) {
    super(`Service ${serviceId} is already provided by ${ownerId}.`);
  }
}

export class ServiceUnavailableError extends RuntimeError {
  constructor(serviceId: string) {
    super(`Service is unavailable: ${serviceId}`);
  }
}

export class UndeclaredServiceDependencyError extends RuntimeError {
  constructor(pluginId: string, serviceId: string) {
    super(`Plugin ${pluginId} tried to use undeclared service dependency ${serviceId}.`);
  }
}

export class UndeclaredServiceProviderError extends RuntimeError {
  constructor(pluginId: string, serviceId: string) {
    super(`Plugin ${pluginId} tried to provide undeclared service ${serviceId}.`);
  }
}

export class MissingDeclaredServiceError extends RuntimeError {
  constructor(pluginId: string, serviceId: string) {
    super(`Plugin ${pluginId} declared service ${serviceId} but did not provide it during setup.`);
  }
}
