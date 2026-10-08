import React, { createContext, useContext } from 'react';

/**
 * Marks a screen presented as a flow: full screen, sliding up from the bottom
 * (see FLOW_OPTIONS in App.tsx). Its header closes with an X instead of going
 * back with an arrow. Only the navigator knows how a screen was presented, so
 * it says so explicitly.
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
