export async function copyMessageText(
  text: string,
  supported: boolean,
  write: (value: string) => Promise<unknown>,
) {
  if (!supported || text === "") return false;
  try {
    await write(text);
    return true;
  } catch {
    return false;
  }
}
