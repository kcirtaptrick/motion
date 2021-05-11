import sync, { cancelSync } from "framesync"
import { Presence } from "../components/AnimateSharedLayout/types"
import { Crossfader } from "../components/AnimateSharedLayout/utils/crossfader"
import { MotionStyle } from "../motion/types"
import {
    // applyBoxTransforms,
    removeBoxTransforms,
} from "../utils/geometry/delta-apply"
// import { updateBoxDelta } from "../utils/geometry/delta-calc"
import { motionValue, MotionValue } from "../value"
import { isMotionValue } from "../value/utils/is-motion-value"
import {
    VisualElement,
    VisualElementConfig,
    VisualElementOptions,
} from "./types"
import { variantPriorityOrder } from "./utils/animation-state"
import { createLifecycles } from "./utils/lifecycles"
import { updateMotionValuesFromProps } from "./utils/motion-values"
import { createLayoutState, createProjectionState } from "./utils/state"
import { FlatTree } from "./utils/flat-tree"
import {
    checkIfControllingVariants,
    checkIfVariantNode,
    isVariantLabel,
} from "./utils/variants"
import { pointElementTo } from "./dom/projection/utils"

export const visualElement = <Instance, MutableState, Options>({
    treeType = "",
    build,
    getBaseTarget,
    makeTargetAnimatable,
    measureViewportBox,
    render: renderInstance,
    readValueFromInstance,
    resetTransform,
    restoreTransform,
    removeValueFromRenderState,
    sortNodePosition,
    scrapeMotionValuesFromProps,
}: VisualElementConfig<Instance, MutableState, Options>) => (
    {
        parent,
        props,
        presenceId,
        blockInitialAnimation,
        visualState,
    }: VisualElementOptions<Instance>,
    options: Options = {} as Options
) => {
    const { latestValues, renderState } = visualState

    /**
     * The instance of the render-specific node that will be hydrated by the
     * exposed React ref. So for example, this visual element can host a
     * HTMLElement, plain object, or Three.js object. The functions provided
     * in VisualElementConfig allow us to interface with this instance.
     */
    let instance: Instance

    /**
     * Manages the subscriptions for a visual element's lifecycle, for instance
     * onRender and onViewportBoxUpdate.
     */
    const lifecycles = createLifecycles()

    /**
     *
     */
    const projection = createProjectionState()

    /**
     * The latest layout measurements and calculated projections. This
     * is seperate from the target projection data in visualState as
     * many visual elements might point to the same piece of visualState as
     * a target, whereas they might each have different layouts and thus
     * projection calculations needed to project into the same viewport box.
     */
    const layoutState = createLayoutState()

    /**
     *
     */
    let crossfader: Crossfader

    /**
     * A map of all motion values attached to this visual element. Motion
     * values are source of truth for any given animated value. A motion
     * value might be provided externally by the component via props.
     */
    const values = new Map<string, MotionValue>()

    /**
     * A map of every subscription that binds the provided or generated
     * motion values onChange listeners to this visual element.
     */
    const valueSubscriptions = new Map<string, () => void>()

    /**
     * A reference to the previously-provided motion values as returned
     * from scrapeMotionValuesFromProps. We use the keys in here to determine
     * if any motion values need to be removed after props are updated.
     */
    let prevMotionValues: MotionStyle = {}

    /**
     * When values are removed from all animation props we need to search
     * for a fallback value to animate to. These values are tracked in baseTarget.
     */
    const baseTarget: { [key: string]: string | number | null } = {
        ...latestValues,
    }

    // Internal methods ========================

    /**
     * On mount, this will be hydrated with a callback to disconnect
     * this visual element from its parent on unmount.
     */
    let removeFromVariantTree: undefined | (() => void)

    /**
     *
     */
    function render() {
        if (!instance) return

        // if (element.isProjectionReady()) {
        //     /**
        //      * Apply the latest user-set transforms to the targetBox to produce the targetBoxFinal.
        //      * This is the final box that we will then project into by calculating a transform delta and
        //      * applying it to the corrected box.
        //      */
        //     applyBoxTransforms(
        //         element.leadProjection.targetFinal,
        //         element.leadProjection.target,
        //         element.leadLatestValues!
        //     )

        //     /**
        //      * Update the delta between the corrected box and the final target box, after
        //      * user-set transforms are applied to it. This will be used by the renderer to
        //      * create a transform style that will reproject the element from its actual layout
        //      * into the desired bounding box.
        //      */
        //     updateBoxDelta(
        //         layoutState.deltaFinal,
        //         layoutState.layoutCorrected,
        //         element.leadProjection.targetFinal,
        //         latestValues
        //     )
        // }

        triggerBuild()

        renderInstance(instance, renderState)
    }

    function triggerBuild() {
        let valuesToRender = latestValues

        if (crossfader && crossfader.isActive()) {
            const crossfadedValues = crossfader.getCrossfadeState(element)
            if (crossfadedValues) valuesToRender = crossfadedValues
        }

        build(
            element,
            renderState,
            valuesToRender,
            element.leadProjection,
            layoutState,
            options,
            props
        )
    }

    function update() {
        lifecycles.notifyUpdate(latestValues)
    }

    /**
     *
     */
    function bindToMotionValue(key: string, value: MotionValue) {
        const removeOnChange = value.onChange(
            (latestValue: string | number) => {
                latestValues[key] = latestValue
                props.onUpdate && sync.update(update, false, true)
            }
        )

        const removeOnRenderRequest = value.onRenderRequest(
            element.scheduleRender
        )

        valueSubscriptions.set(key, () => {
            removeOnChange()
            removeOnRenderRequest()
        })
    }

    /**
     * Any motion values that are provided to the element when created
     * aren't yet bound to the element, as this would technically be impure.
     * However, we iterate through the motion values and set them to the
     * initial values for this component.
     *
     * TODO: This is impure and we should look at changing this to run on mount.
     * Doing so will break some tests but this isn't neccessarily a breaking change,
     * more a reflection of the test.
     */
    const initialMotionValues = scrapeMotionValuesFromProps(props)
    for (const key in initialMotionValues) {
        const value = initialMotionValues[key]
        if (latestValues[key] !== undefined && isMotionValue(value)) {
            value.set(latestValues[key], false)
        }
    }

    /**
     * Determine what role this visual element should take in the variant tree.
     */
    const isControllingVariants = checkIfControllingVariants(props)
    const isVariantNode = checkIfVariantNode(props)

    const element: VisualElement<Instance> = {
        treeType,

        /**
         * This is a mirror of the internal instance prop, which keeps
         * VisualElement type-compatible with React's RefObject.
         */
        current: null,

        /**
         * The depth of this visual element within the visual element tree.
         */
        depth: parent ? parent.depth + 1 : 0,

        parent,

        children: new Set(),

        /**
         * An ancestor path back to the root visual element. This is used
         * by layout projection to quickly recurse back up the tree.
         */
        path: parent ? [...parent.path, parent] : [],

        layoutTree: parent ? parent.layoutTree : new FlatTree(),

        /**
         *
         */
        presenceId,

        projection,
        leadProjection: projection,

        /**
         * If this component is part of the variant tree, it should track
         * any children that are also part of the tree. This is essentially
         * a shadow tree to simplify logic around how to stagger over children.
         */
        variantChildren: isVariantNode ? new Set() : undefined,

        /**
         * Whether this instance is visible. This can be changed imperatively
         * by AnimateSharedLayout, is analogous to CSS's visibility in that
         * hidden elements should take up layout, and needs enacting by the configured
         * render function.
         */
        isVisible: undefined,

        /**
         * Normally, if a component is controlled by a parent's variants, it can
         * rely on that ancestor to trigger animations further down the tree.
         * However, if a component is created after its parent is mounted, the parent
         * won't trigger that mount animation so the child needs to.
         *
         * TODO: This might be better replaced with a method isParentMounted
         */
        manuallyAnimateOnMount: Boolean(parent?.isMounted()),

        /**
         * This can be set by AnimatePresence to force components that mount
         * at the same time as it to mount as if they have initial={false} set.
         */
        blockInitialAnimation,

        /**
         * Keep track of whether the viewport box has been updated since the
         * last time the layout projection was re-calculated.
         */
        hasViewportBoxUpdated: false,

        /**
         * Determine whether this component has mounted yet. This is mostly used
         * by variant children to determine whether they need to trigger their
         * own animations on mount.
         */
        isMounted: () => Boolean(instance),

        mount(newInstance: Instance) {
            instance = element.current = newInstance
            pointElementTo(element, element)

            if (isVariantNode && parent && !isControllingVariants) {
                removeFromVariantTree = parent?.addVariantChild(element)
            }
            parent?.children.add(element)
        },

        /**
         *
         */
        unmount() {
            cancelSync.update(update)
            cancelSync.render(render)
            valueSubscriptions.forEach((remove) => remove())
            element.layoutTree.remove(element)
            removeFromVariantTree?.()
            parent?.children.delete(element)
            lifecycles.clearAllListeners()

            if (element.projectionMethods) {
                element.projectionMethods.destroy()
            }
        },

        /**
         * Add a child visual element to our set of children.
         */
        addVariantChild(child) {
            const closestVariantNode = element.getClosestVariantNode()
            if (closestVariantNode) {
                closestVariantNode.variantChildren?.add(child)
                return () => closestVariantNode.variantChildren!.delete(child)
            }
        },

        sortNodePosition(other: VisualElement) {
            /**
             * If these nodes aren't even of the same type we can't compare their depth.
             */
            if (!sortNodePosition || treeType !== other.treeType) return 0
            return sortNodePosition(
                element.getInstance() as Instance,
                other.getInstance()
            )
        },

        /**
         * Returns the closest variant node in the tree starting from
         * this visual element.
         */
        getClosestVariantNode: () =>
            isVariantNode ? element : parent?.getClosestVariantNode(),

        /**
         * A method that schedules an update to layout projections throughout
         * the tree. We inherit from the parent so there's only ever one
         * job scheduled on the next frame - that of the root visual element.
         */
        scheduleUpdateLayoutProjection: parent
            ? parent.scheduleUpdateLayoutProjection
            : () => {
                  sync.preRender(() => {}, false, true)
              },

        /**
         * Expose the latest layoutId prop.
         */
        getLayoutId: () => props.layoutId,

        /**
         * Returns the current instance.
         */
        getInstance: () => instance,

        /**
         * Get/set the latest static values.
         */
        getStaticValue: (key) => latestValues[key],
        setStaticValue: (key, value) => (latestValues[key] = value),

        /**
         * Returns the latest motion value state. Currently only used to take
         * a snapshot of the visual element - perhaps this can return the whole
         * visual state
         */
        getLatestValues: () => latestValues,

        /**
         * Set the visiblity of the visual element. If it's changed, schedule
         * a render to reflect these changes.
         */
        setVisibility(visibility) {
            if (element.isVisible === visibility) return
            element.isVisible = visibility

            element.scheduleRender()
        },

        /**
         * Make a target animatable by Popmotion. For instance, if we're
         * trying to animate width from 100px to 100vw we need to measure 100vw
         * in pixels to determine what we really need to animate to. This is also
         * pluggable to support Framer's custom value types like Color,
         * and CSS variables.
         */
        makeTargetAnimatable(target, canMutate = true) {
            return makeTargetAnimatable(element, target, props, canMutate)
        },

        // Motion values ========================

        /**
         * Add a motion value and bind it to this visual element.
         */
        addValue(key, value) {
            // Remove existing value if it exists
            if (element.hasValue(key)) element.removeValue(key)

            values.set(key, value)
            latestValues[key] = value.get()
            bindToMotionValue(key, value)
        },

        /**
         * Remove a motion value and unbind any active subscriptions.
         */
        removeValue(key) {
            values.delete(key)
            valueSubscriptions.get(key)?.()
            valueSubscriptions.delete(key)
            delete latestValues[key]
            removeValueFromRenderState(key, renderState)
        },

        /**
         * Check whether we have a motion value for this key
         */
        hasValue: (key) => values.has(key),

        /**
         * Get a motion value for this key. If called with a default
         * value, we'll create one if none exists.
         */
        getValue(key: string, defaultValue?: string | number) {
            let value = values.get(key)

            if (value === undefined && defaultValue !== undefined) {
                value = motionValue(defaultValue)
                element.addValue(key, value)
            }

            return value as MotionValue
        },

        /**
         * Iterate over our motion values.
         */
        forEachValue: (callback) => values.forEach(callback),

        /**
         * If we're trying to animate to a previously unencountered value,
         * we need to check for it in our state and as a last resort read it
         * directly from the instance (which might have performance implications).
         */
        readValue: (key: string) =>
            latestValues[key] ?? readValueFromInstance(instance, key, options),

        /**
         * Set the base target to later animate back to. This is currently
         * only hydrated on creation and when we first read a value.
         */
        setBaseTarget(key, value) {
            baseTarget[key] = value
        },

        /**
         * Find the base target for a value thats been removed from all animation
         * props.
         */
        getBaseTarget(key) {
            if (getBaseTarget) {
                const target = getBaseTarget(props, key)
                if (target !== undefined && !isMotionValue(target))
                    return target
            }
            return baseTarget[key]
        },

        // Lifecyles ========================

        ...lifecycles,

        /**
         * Build the renderer state based on the latest visual state.
         */
        build() {
            triggerBuild()
            return renderState
        },

        /**
         * Schedule a render on the next animation frame.
         */
        scheduleRender() {
            sync.render(render, false, true)
        },

        /**
         * Synchronously fire render. It's prefered that we batch renders but
         * in many circumstances, like layout measurement, we need to run this
         * synchronously. However in those instances other measures should be taken
         * to batch reads/writes.
         */
        syncRender: render,

        /**
         * Update the provided props. Ensure any newly-added motion values are
         * added to our map, old ones removed, and listeners updated.
         */
        setProps(newProps) {
            props = newProps
            lifecycles.updatePropListeners(newProps)

            prevMotionValues = updateMotionValuesFromProps(
                element,
                scrapeMotionValuesFromProps(props),
                prevMotionValues
            )
        },

        getProps: () => props,

        // Variants ==============================

        /**
         * Returns the variant definition with a given name.
         */
        getVariant: (name) => props.variants?.[name],

        /**
         * Returns the defined default transition on this component.
         */
        getDefaultTransition: () => props.transition,

        /**
         * Used by child variant nodes to get the closest ancestor variant props.
         */
        getVariantContext(startAtParent = false) {
            if (startAtParent) return parent?.getVariantContext()

            if (!isControllingVariants) {
                const context = parent?.getVariantContext() || {}
                if (props.initial !== undefined) {
                    context.initial = props.initial as any
                }
                return context
            }

            const context = {}
            for (let i = 0; i < numVariantProps; i++) {
                const name = variantProps[i]
                const prop = props[name]

                if (isVariantLabel(prop) || prop === false) {
                    context[name] = prop
                }
            }

            return context
        },

        // Layout projection ==============================

        getLayoutState: () => layoutState,

        setCrossfader(newCrossfader) {
            crossfader = newCrossfader
        },

        isProjectionReady: () =>
            projection.isEnabled &&
            projection.isHydrated &&
            layoutState.isHydrated,

        /**
         * Measure the current viewport box with or without transforms.
         * Only measures axis-aligned boxes, rotate and skew must be manually
         * removed with a re-render to work.
         */
        measureViewportBox(withTransform = true) {
            const viewportBox = measureViewportBox(instance, options)
            if (!withTransform) removeBoxTransforms(viewportBox, latestValues)
            return viewportBox
        },

        /**
         * Temporarily reset the transform of the instance.
         */
        resetTransform: () => resetTransform(element, instance, props),

        restoreTransform: () => restoreTransform(instance, renderState),

        shouldResetTransform() {
            return Boolean(props._layoutResetTransform)
        },

        // TODO: Clean this up
        isPresent: true,
        presence: Presence.Entering,
    }

    return element
}

const variantProps = ["initial", ...variantPriorityOrder]
const numVariantProps = variantProps.length
