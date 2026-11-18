// JSON values of input files as selectable text (crypt-ui Requirements 7.1, 8.7).
export function JsonText({ value }: { value: unknown }) {
  return (
    <pre>
      <code>{JSON.stringify(value, null, 2) ?? "undefined"}</code>
    </pre>
  );
}
