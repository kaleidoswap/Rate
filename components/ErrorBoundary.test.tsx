// components/ErrorBoundary.test.tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';
import ErrorBoundary from './ErrorBoundary';

// Component that throws an error
const ThrowError: React.FC<{ shouldThrow: boolean; message?: string }> = ({ 
  shouldThrow, 
  message = 'Test error' 
}) => {
  if (shouldThrow) {
    throw new Error(message);
  }
  return <Text>No error</Text>;
};

describe('ErrorBoundary', () => {
  // Suppress console.error for cleaner test output
  const originalError = console.error;
  beforeAll(() => {
    console.error = jest.fn();
  });

  afterAll(() => {
    console.error = originalError;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Normal Operation', () => {
    it('should render children when no error occurs', () => {
      const { getByText } = render(
        <ErrorBoundary>
          <ThrowError shouldThrow={false} />
        </ErrorBoundary>
      );

      expect(getByText('No error')).toBeTruthy();
    });

    it('should render multiple children', () => {
      const { getByText } = render(
        <ErrorBoundary>
          <Text>Child 1</Text>
          <Text>Child 2</Text>
          <ThrowError shouldThrow={false} />
        </ErrorBoundary>
      );

      expect(getByText('Child 1')).toBeTruthy();
      expect(getByText('Child 2')).toBeTruthy();
      expect(getByText('No error')).toBeTruthy();
    });
  });

  describe('Error Handling', () => {
    it('should catch errors and display fallback UI', () => {
      const { getByText, queryByText } = render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      // Fallback UI should be displayed
      expect(getByText(/Something went wrong/i)).toBeTruthy();
      // Original children should not be displayed
      expect(queryByText('No error')).toBeNull();
    });

    it('should display error message in fallback UI', () => {
      const { getByText } = render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} message="Custom error message" />
        </ErrorBoundary>
      );

      expect(getByText(/Something went wrong/i)).toBeTruthy();
      // Error details should be accessible
      expect(getByText(/Custom error message/i)).toBeTruthy();
    });

    it('should log error to console', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} message="Logged error" />
        </ErrorBoundary>
      );

      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('Reset Functionality', () => {
    it('should reset error state when reset button is pressed', () => {
      const { getByText, queryByText, rerender } = render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      // Error UI should be displayed
      expect(getByText(/Something went wrong/i)).toBeTruthy();

      // Swap in a non-throwing child BEFORE pressing reset. The boundary
      // still shows the error UI here (render() only reads `hasError`,
      // it never re-evaluates children while an error is active) — but
      // if we pressed reset first instead, componentDidCatch would just
      // catch the still-throwing child again immediately, undoing the
      // reset within the same commit.
      rerender(
        <ErrorBoundary>
          <ThrowError shouldThrow={false} />
        </ErrorBoundary>
      );
      expect(getByText(/Something went wrong/i)).toBeTruthy();

      // Now reset: hasError clears, and props.children is already safe to render.
      const resetButton = getByText(/Try Again/i);
      fireEvent.press(resetButton);

      // Children should be displayed again
      expect(queryByText('No error')).toBeTruthy();
      expect(queryByText(/Something went wrong/i)).toBeNull();
    });

    it('should call custom onReset callback', () => {
      const onReset = jest.fn();
      const { getByText } = render(
        <ErrorBoundary onReset={onReset}>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      const resetButton = getByText(/Try Again/i);
      fireEvent.press(resetButton);

      expect(onReset).toHaveBeenCalledTimes(1);
    });
  });

  describe('Custom Fallback', () => {
    // ErrorBoundary's `fallback` prop is a plain callback called positionally
    // as fallback(error, errorInfo, reset) — its return value is used directly
    // as the render output, it is NOT rendered as a React component via
    // createElement. So the callback receives three arguments, not one props object.
    it('should use custom fallback component', () => {
      const CustomFallback = (error: Error) => (
        <Text>Custom error: {error.message}</Text>
      );

      const { getByText } = render(
        <ErrorBoundary fallback={CustomFallback}>
          <ThrowError shouldThrow={true} message="Custom fallback test" />
        </ErrorBoundary>
      );

      expect(getByText('Custom error: Custom fallback test')).toBeTruthy();
    });

    it('should pass error and resetError to custom fallback', () => {
      const CustomFallback = jest.fn(() => <Text>Custom Fallback</Text>);

      render(
        <ErrorBoundary fallback={CustomFallback}>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(CustomFallback).toHaveBeenCalledWith(
        expect.any(Error),
        expect.anything(),
        expect.any(Function)
      );
    });
  });

  describe('Error Boundaries Nesting', () => {
    it('should only catch errors in immediate children', () => {
      const { getByText } = render(
        <ErrorBoundary>
          <ErrorBoundary>
            <ThrowError shouldThrow={true} />
          </ErrorBoundary>
        </ErrorBoundary>
      );

      // Inner error boundary should catch the error
      expect(getByText(/Something went wrong/i)).toBeTruthy();
    });

    it('should not catch errors from parent boundary', () => {
      const { queryByText } = render(
        <ErrorBoundary>
          <Text>Parent content</Text>
          <ErrorBoundary>
            <ThrowError shouldThrow={false} />
          </ErrorBoundary>
        </ErrorBoundary>
      );

      expect(queryByText('Parent content')).toBeTruthy();
      expect(queryByText('No error')).toBeTruthy();
    });
  });

  describe('Multiple Errors', () => {
    it('should handle consecutive errors', () => {
      const { getByText, rerender } = render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} message="First error" />
        </ErrorBoundary>
      );

      expect(getByText(/First error/i)).toBeTruthy();

      // Swap in the next (also-throwing) child BEFORE resetting — same
      // reasoning as the reset test above: render() won't look at the new
      // child until hasError clears, so pressing reset first would just
      // re-catch "First error" again instead of ever seeing "Second error".
      rerender(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} message="Second error" />
        </ErrorBoundary>
      );
      expect(getByText(/First error/i)).toBeTruthy();

      // Reset: hasError clears, props.children (the "Second error" thrower)
      // renders, throws, and gets caught fresh.
      const resetButton = getByText(/Try Again/i);
      fireEvent.press(resetButton);

      expect(getByText(/Second error/i)).toBeTruthy();
    });
  });

  describe('Accessibility', () => {
    it('should have accessible error message', () => {
      const { getByText } = render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      const errorMessage = getByText(/Something went wrong/i);
      expect(errorMessage.props.accessibilityRole).toBeDefined();
    });

    it('should have accessible reset button', () => {
      const { getByText } = render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      const resetButton = getByText(/Try Again/i);
      expect(resetButton).toBeTruthy();
    });
  });
});



