import { getPerformance, trace as rnTrace } from '@react-native-firebase/perf';
import { firebaseApp } from './app';

const perf = getPerformance(firebaseApp);

export type TraceName =
  | 'app_startup'
  | 'login_flow'
  | 'home_load'
  | 'matchmaking'
  | 'room_join'
  | 'match_start'
  | 'profile_load'
  | 'match_result'
  | 'function_call';

/** Starts a custom trace; call the returned stop() when the measured work ends. */
export async function startTrace(name: TraceName, attrs?: Record<string, string>) {
  try {
    const t = rnTrace(perf, name);
    if (attrs) for (const [k, v] of Object.entries(attrs)) t.putAttribute(k, v);
    await t.start();
    return async () => {
      try {
        await t.stop();
      } catch {
        // ignore
      }
    };
  } catch {
    return async () => undefined;
  }
}

/** Measures an async block. */
export async function traced<T>(
  name: TraceName,
  fn: () => Promise<T>,
  attrs?: Record<string, string>,
): Promise<T> {
  const stop = await startTrace(name, attrs);
  try {
    return await fn();
  } finally {
    await stop();
  }
}
