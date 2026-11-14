/** npm package name validation (Requirement 1.1, 1.8). Pure. */

export const MAX_PACKAGE_NAME_LENGTH = 214;

const SEGMENT = /^[a-z0-9~-][a-z0-9._~-]*$/;

/** Returns a reason when `name` is not a valid npm package name, otherwise null. */
export function packageNameProblem(name: string): string | null {
  if (name.length === 0) return "package name is empty";
  if (name.length > MAX_PACKAGE_NAME_LENGTH) {
    return `package name is longer than ${MAX_PACKAGE_NAME_LENGTH} characters`;
  }
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash === -1) return "scoped package name must have the form @scope/name";
    const scope = name.slice(1, slash);
    const rest = name.slice(slash + 1);
    if (scope.length === 0 || rest.length === 0) {
      return "scoped package name must have the form @scope/name";
    }
    if (!SEGMENT.test(scope) || !SEGMENT.test(rest)) {
      return "package name must be lowercase, URL-safe, and not start with '.' or '_'";
    }
    return null;
  }
  if (!SEGMENT.test(name)) {
    return "package name must be lowercase, URL-safe, and not start with '.' or '_'";
  }
  return null;
}

export function isValidPackageName(name: string): boolean {
  return packageNameProblem(name) === null;
}
