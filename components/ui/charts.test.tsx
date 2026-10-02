import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import {
  BarChart,
  chartCategories,
  DonutChart,
  LineChart,
  Meter,
  ScatterChart,
  TrendChart,
} from './charts';

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Circle: 'Circle',
  Rect: 'Rect',
  Polyline: 'Polyline',
}));

test('categorical charts fold excess series into Other without reusing colors', () => {
  const data = Array.from({ length: 8 }, (_, i) => ({
    label: String(i),
    value: i + 1,
  }));
  const reduced = chartCategories(data);
  expect(reduced).toHaveLength(6);
  expect(reduced[5]).toEqual({ label: 'Other', value: 6 + 7 + 8 });
  const ui = render(<BarChart label="Categories" data={data} />);
  expect(ui.getByRole('image').props.accessibilityLabel).toContain('Other: 21');
  fireEvent.press(ui.getByText('View chart data +'));
  expect(ui.getByLabelText('Value: 21')).toBeTruthy();
});

test('empty and zero totals do not create invalid chart coordinates', () => {
  const ui = render(<DonutChart label="No history" data={[]} />);
  expect(ui.getByText('No data available')).toBeTruthy();
  ui.rerender(<DonutChart label="Zero" data={[{ label: 'A', value: 0 }]} />);
  expect(JSON.stringify(ui.toJSON())).not.toMatch(/NaN|Infinity/);
  ui.rerender(
    <LineChart label="Single point" data={[{ label: 'A', value: -2 }]} />
  );
  expect(JSON.stringify(ui.toJSON())).not.toMatch(/NaN|Infinity/);
  ui.unmount();
  const trend = render(
    <TrendChart label="Empty buckets" series={[]} buckets={[]} />
  );
  expect(trend.getByText('No data available')).toBeTruthy();
});

test('scatter refuses excessive series instead of silently hiding data', () => {
  const ui = render(
    <ScatterChart
      label="Scatter"
      series={Array.from({ length: 4 }, (_, i) => ({
        label: String(i),
        points: [{ x: i, y: i }],
      }))}
    />
  );
  expect(ui.getByText('Scatter: choose at most 3 series.')).toBeTruthy();
});

test('meter clamps the visual and accessibility value without concealing the actual value', () => {
  const ui = render(<Meter label="Progress" value={120} max={100} />);
  expect(ui.getByText('Progress: 120 / 100')).toBeTruthy();
  expect(ui.getByRole('progressbar').props.accessibilityValue.now).toBe(100);
  ui.rerender(<Meter label="Progress" value={NaN} />);
  expect(ui.getByText('Progress: Unavailable')).toBeTruthy();
});
