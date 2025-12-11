// components/Button.test.tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Button } from './Button';

describe('Button', () => {
  describe('Rendering', () => {
    it('should render with title', () => {
      const { getByText } = render(
        <Button title="Click Me" onPress={jest.fn()} />
      );

      expect(getByText('Click Me')).toBeTruthy();
    });

    it('should render primary variant by default', () => {
      const { getByText } = render(
        <Button title="Primary" onPress={jest.fn()} />
      );

      const button = getByText('Primary');
      expect(button).toBeTruthy();
    });

    it('should render secondary variant', () => {
      const { getByText } = render(
        <Button title="Secondary" onPress={jest.fn()} variant="secondary" />
      );

      expect(getByText('Secondary')).toBeTruthy();
    });

    it('should render ghost variant', () => {
      const { getByText } = render(
        <Button title="Ghost" onPress={jest.fn()} variant="ghost" />
      );

      expect(getByText('Ghost')).toBeTruthy();
    });

    it('should render success variant', () => {
      const { getByText } = render(
        <Button title="Success" onPress={jest.fn()} variant="success" />
      );

      expect(getByText('Success')).toBeTruthy();
    });

    it('should render warning variant', () => {
      const { getByText } = render(
        <Button title="Warning" onPress={jest.fn()} variant="warning" />
      );

      expect(getByText('Warning')).toBeTruthy();
    });

    it('should render error variant', () => {
      const { getByText } = render(
        <Button title="Error" onPress={jest.fn()} variant="error" />
      );

      expect(getByText('Error')).toBeTruthy();
    });

    it('should render different sizes', () => {
      const { getByText: getSmall } = render(
        <Button title="Small" onPress={jest.fn()} size="sm" />
      );
      const { getByText: getMedium } = render(
        <Button title="Medium" onPress={jest.fn()} size="md" />
      );
      const { getByText: getLarge } = render(
        <Button title="Large" onPress={jest.fn()} size="lg" />
      );

      expect(getSmall('Small')).toBeTruthy();
      expect(getMedium('Medium')).toBeTruthy();
      expect(getLarge('Large')).toBeTruthy();
    });

    it('should render with icon', () => {
      const { getByText, UNSAFE_getByType } = render(
        <Button
          title="With Icon"
          onPress={jest.fn()}
          icon={<>Icon</>}
        />
      );

      expect(getByText('With Icon')).toBeTruthy();
    });
  });

  describe('Interaction', () => {
    it('should call onPress when pressed', () => {
      const onPress = jest.fn();
      const { getByText } = render(
        <Button title="Press Me" onPress={onPress} />
      );

      fireEvent.press(getByText('Press Me'));

      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('should not call onPress when disabled', () => {
      const onPress = jest.fn();
      const { getByText } = render(
        <Button title="Disabled" onPress={onPress} disabled />
      );

      fireEvent.press(getByText('Disabled'));

      expect(onPress).not.toHaveBeenCalled();
    });

    it('should not call onPress when loading', () => {
      const onPress = jest.fn();
      const { getByTestId } = render(
        <Button title="Loading" onPress={onPress} loading />
      );

      const button = getByTestId('button-touchable');
      fireEvent.press(button);

      expect(onPress).not.toHaveBeenCalled();
    });
  });

  describe('Loading State', () => {
    it('should show activity indicator when loading', () => {
      const { getByTestId, queryByText } = render(
        <Button title="Loading" onPress={jest.fn()} loading />
      );

      expect(getByTestId('button-loading')).toBeTruthy();
      expect(queryByText('Loading')).toBeNull();
    });

    it('should hide title when loading', () => {
      const { queryByText } = render(
        <Button title="Loading" onPress={jest.fn()} loading />
      );

      expect(queryByText('Loading')).toBeNull();
    });
  });

  describe('Disabled State', () => {
    it('should apply disabled styles', () => {
      const { getByTestId } = render(
        <Button title="Disabled" onPress={jest.fn()} disabled />
      );

      const button = getByTestId('button-touchable');
      expect(button.props.accessibilityState?.disabled).toBe(true);
    });
  });

  describe('Custom Styles', () => {
    it('should apply custom style', () => {
      const customStyle = { marginTop: 20 };
      const { getByTestId } = render(
        <Button title="Custom" onPress={jest.fn()} style={customStyle} />
      );

      const button = getByTestId('button-touchable');
      expect(button.props.style).toEqual(
        expect.arrayContaining([expect.objectContaining(customStyle)])
      );
    });

    it('should apply custom text style', () => {
      const customTextStyle = { fontSize: 20 };
      const { getByText } = render(
        <Button title="Custom Text" onPress={jest.fn()} textStyle={customTextStyle} />
      );

      const text = getByText('Custom Text');
      expect(text.props.style).toEqual(
        expect.arrayContaining([expect.objectContaining(customTextStyle)])
      );
    });
  });

  describe('Full Width', () => {
    it('should render full width button', () => {
      const { getByTestId } = render(
        <Button title="Full Width" onPress={jest.fn()} fullWidth />
      );

      const button = getByTestId('button-touchable');
      expect(button.props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ width: '100%' })])
      );
    });
  });

  describe('Accessibility', () => {
    it('should have accessible label', () => {
      const { getByText } = render(
        <Button title="Accessible" onPress={jest.fn()} />
      );

      const button = getByText('Accessible');
      expect(button).toBeTruthy();
    });

    it('should indicate disabled state', () => {
      const { getByTestId } = render(
        <Button title="Disabled" onPress={jest.fn()} disabled />
      );

      const button = getByTestId('button-touchable');
      expect(button.props.accessibilityState?.disabled).toBe(true);
    });
  });
});

