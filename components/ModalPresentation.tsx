import React, { createContext, useContext } from 'react';

/**
 * Marks a screen that the navigator presents as a sheet (`presentation: 'modal'`).
 *
 * `useSafeAreaInsets()` reports the WINDOW's insets, not the presented view's, and
 * react-navigation 6 re-establishes no safe-area provider per modal. A sheet already
 * starts below the status bar, so a header that pads by the full top inset stacks a
 * second status bar's worth of empty space above its title.
 *
 * Detecting this at runtime is unreliable — inside a sheet `measureInWindow` reports
 * coordinates relative to the sheet, so the header reads y = 0 and looks full-screen.
 * The navigator is the only place that actually knows, so it says so explicitly.
 */
const ModalPresentationContext = createContext(false);

/** True when the surrounding screen is presented as a sheet. */
export const useIsModalPresentation = (): boolean => useContext(ModalPresentationContext);

/**
 * Wraps a screen component so everything inside it knows it is presented as a sheet.
 *
 * Memoised per component: `component={asModalScreen(X)}` is evaluated on every render
 * of the navigator, and returning a fresh component each time would remount the screen
 * and drop its state.
 */
const wrapped = new WeakMap<React.ComponentType<any>, React.ComponentType<any>>();

// Returns the SAME component type it was given: react-navigation types a screen by
// its own props, and widening to ComponentType<P> makes `component={...}` unassignable.
export function asModalScreen<C extends React.ComponentType<any>>(Screen: C): C {
  const cached = wrapped.get(Screen);
  if (cached) return cached as C;

  const ModalScreen = (props: React.ComponentProps<C>) => (
    <ModalPresentationContext.Provider value={true}>
      <Screen {...(props as any)} />
    </ModalPresentationContext.Provider>
  );
  ModalScreen.displayName = `AsModalScreen(${Screen.displayName || Screen.name || 'Screen'})`;

  wrapped.set(Screen, ModalScreen as React.ComponentType<any>);
  return ModalScreen as unknown as C;
}

export default asModalScreen;
