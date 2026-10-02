import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Clipboard, StyleSheet, Text } from 'react-native';
import { CopyButton } from '../CopyButton';
import { SegmentedTabs } from '../SegmentedTabs';
import { QueryState, Pager, DateRangeFilter, dateRangeError } from './lists';
import { Dialog, DropdownMenu } from './overlays';
import { Avatar, Collapsible, FormField } from './surfaces';
import { AppThemeProvider } from '../../theme/ThemeProvider';
import { lightTheme } from '../../theme';
import { Button } from '../Button';
import { Card } from '../Card';

beforeEach(() => {
  jest.clearAllMocks();
});

test('query states keep loading and failures distinct from an empty result', () => {
  const ui = render(
    <QueryState isLoading error="Offline" isEmpty>
      <Text>Records</Text>
    </QueryState>
  );
  expect(ui.getByLabelText('Loading')).toBeTruthy();
  expect(ui.queryByText('Nothing here yet')).toBeNull();
  const retry = jest.fn();
  ui.rerender(<QueryState error="Offline" isEmpty onRetry={retry} />);
  expect(ui.getByText('Offline')).toBeTruthy();
  expect(ui.queryByText('Nothing here yet')).toBeNull();
  fireEvent.press(ui.getByText('Try again'));
  expect(retry).toHaveBeenCalledTimes(1);
  ui.rerender(
    <QueryState
      error="Unavailable"
      onRetry={retry}
      classifyError={() => ({
        title: 'Unavailable',
        message: 'Disabled by server',
        retryable: false,
        tone: 'info',
      })}
    />
  );
  expect(ui.queryByText('Try again')).toBeNull();
});

test('pagination does not invent a total or advance from a partial last page', () => {
  const change = jest.fn();
  const ui = render(
    <Pager offset={10} limit={10} returned={3} onOffsetChange={change} />
  );
  expect(ui.getByText('rows 11–13')).toBeTruthy();
  fireEvent.press(ui.getByText('Next'));
  expect(change).not.toHaveBeenCalled();
  fireEvent.press(ui.getByText('Previous'));
  expect(change).toHaveBeenCalledWith(0);
});

test('dates reject impossible and reversed ranges before refresh', () => {
  expect(dateRangeError({ from: '2026-02-30', to: '' })).toBeTruthy();
  expect(dateRangeError({ from: '2026-10-03', to: '2026-10-02' })).toBeTruthy();
  expect(
    dateRangeError({ from: '2024-02-29', to: '2024-03-01' })
  ).toBeUndefined();
  const refresh = jest.fn();
  const ui = render(
    <DateRangeFilter
      value={{ from: 'invalid', to: '' }}
      onChange={jest.fn()}
      onRefresh={refresh}
    />
  );
  fireEvent.press(ui.getByText('Refresh'));
  expect(refresh).not.toHaveBeenCalled();
});

test('copy reports failure, retries and resets when the value changes', async () => {
  const copied = jest.fn();
  (Clipboard.setString as jest.Mock).mockImplementationOnce(() => {
    throw Error('Clipboard unavailable');
  });
  const ui = render(
    <CopyButton value="public-address" label="Copy address" onCopied={copied} />
  );
  await act(async () => fireEvent.press(ui.getByLabelText('Copy address')));
  expect(ui.getByText('Could not copy. Try again')).toBeTruthy();
  expect(copied).not.toHaveBeenCalled();
  (Clipboard.setString as jest.Mock).mockImplementation(() => undefined);
  await act(async () =>
    fireEvent.press(ui.getByText('Could not copy. Try again'))
  );
  expect(ui.getByText('Copied')).toBeTruthy();
  expect(copied).toHaveBeenCalledTimes(1);
  ui.rerender(<CopyButton value="new-address" label="Copy address" />);
  expect(ui.queryByText('Copied')).toBeNull();
});

test('stale clipboard completions cannot report success for a different value', async () => {
  let finish: () => void = () => {};
  (Clipboard.setString as jest.Mock).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const copied = jest.fn(),
    ui = render(<CopyButton value="old" label="Copy" onCopied={copied} />);
  fireEvent.press(ui.getByLabelText('Copy'));
  ui.rerender(<CopyButton value="new" label="Copy" onCopied={copied} />);
  await act(async () => finish());
  expect(copied).not.toHaveBeenCalled();
  expect(ui.queryByText('Copied')).toBeNull();
});

test('disabled tabs and menu items never trigger actions', () => {
  const change = jest.fn();
  const ui = render(
    <SegmentedTabs
      value="one"
      onChange={change}
      options={[
        { key: 'one', label: 'One' },
        { key: 'two', label: 'Two', disabled: true },
      ]}
    />
  );
  fireEvent.press(ui.getByLabelText('Two'));
  expect(change).not.toHaveBeenCalled();
  ui.unmount();
  const menu = render(
    <DropdownMenu
      visible
      title="Actions"
      onClose={jest.fn()}
      items={[
        { id: 'one', label: 'Unavailable', disabled: true, onPress: change },
      ]}
    />
  );
  fireEvent.press(menu.getByText('Unavailable'));
  expect(change).not.toHaveBeenCalled();
});

test('dialogs dismiss by close and Android back, and can hide the close control', () => {
  const close = jest.fn();
  const ui = render(
    <Dialog visible title="Review" onClose={close}>
      <Text>Content</Text>
    </Dialog>
  );
  fireEvent.press(ui.getByLabelText('Close Review'));
  fireEvent(ui.UNSAFE_getByType(require('react-native').Modal), 'requestClose');
  expect(close).toHaveBeenCalledTimes(2);
  ui.rerender(
    <Dialog visible showClose={false} title="Review" onClose={close}>
      <Text>Content</Text>
    </Dialog>
  );
  expect(ui.queryByLabelText('Close Review')).toBeNull();
});

test('collapsible and avatar fallback remain readable without remote images', () => {
  const ui = render(
    <Collapsible title="Details">
      <Text>Full details</Text>
      <Avatar name="Ada Lovelace" />
    </Collapsible>
  );
  expect(ui.queryByText('Full details')).toBeNull();
  fireEvent.press(ui.getByText('Details +'));
  expect(ui.getByText('Full details')).toBeTruthy();
  expect(ui.getByText('AL')).toBeTruthy();
});

test('shared components use the provided light theme and keep field labels accessible', () => {
  const ui = render(
    <AppThemeProvider theme={lightTheme}>
      <Card testID="card">
        <FormField label="Address" />
        <Button title="Continue" onPress={jest.fn()} />
      </Card>
    </AppThemeProvider>
  );
  expect(StyleSheet.flatten(ui.getByTestId('card').props.style)).toMatchObject({
    backgroundColor: lightTheme.colors.surface.primary,
  });
  expect(
    StyleSheet.flatten(ui.getByLabelText('Address').props.style)
  ).toMatchObject({
    color: lightTheme.colors.text.primary,
  });
  expect(
    StyleSheet.flatten(ui.getByTestId('button-touchable').props.style)
  ).toMatchObject({
    backgroundColor: lightTheme.colors.primary[500],
  });
});
