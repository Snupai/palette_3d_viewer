import { createTranslator } from "./format";
import { de } from "./messages";

/**
 * German translator without a React context. For unit tests of `*Model.ts`
 * code that takes a `t` parameter, and for the no-provider default.
 */
export const translateDe = createTranslator(de, de);
