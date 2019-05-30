import { createAnticipate, anticipate } from "./anticipate"
import { createBackIn, backIn, backOut, backInOut } from "./back"
import { createBounce, bounceIn, bounceOut, bounceInOut } from "./bounce"
import { circIn, circOut, circInOut } from "./circ"
import { cubicBezier } from "./cubicBezier"
import { createExpoIn, expoIn, expoOut, expoInOut } from "./expo"
import { linear } from "./linear"
import { reversed, mirrored } from "./modifiers"
import { steps } from "./steps"

// Without importing and exporting these types, TypeScript generates dynamic types
// like import("./types").EasingFunction, which error in API extractor
import { EasingModifier } from "./modifiers"
import { EasingFunction } from "./types"
import { Direction } from "./steps"
export { EasingModifier, EasingFunction, Direction }

/**
 * @public
 */
export const Easing = {
    createAnticipate,
    anticipate,
    createBackIn,
    backIn,
    backOut,
    backInOut,
    createBounce,
    bounceIn,
    bounceOut,
    bounceInOut,
    circIn,
    circOut,
    circInOut,
    cubicBezier,
    createExpoIn,
    expoIn,
    expoOut,
    expoInOut,
    linear,
    reversed,
    mirrored,
    steps,
}
