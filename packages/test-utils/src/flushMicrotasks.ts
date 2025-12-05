import { act } from './createRenderer';

export async function flushMicrotasks() {
  await act(async () => {});
}
