import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Polyline, Rect } from 'react-native-svg';
import { useAppTheme } from '../../theme/ThemeProvider';
import {
  chartSeries,
  chartSeriesLimit,
  chartScatterSeriesLimit,
} from '../../theme/partner';
import { Typography } from './typography';
import { Surface } from './surfaces';
import { Collapsible } from './surfaces';
import { Table } from './lists';

export interface ChartDatum {
  label: string;
  value: number;
}
/** Never cycle the six-color palette; keep the leading categories and fold the tail into Other. */
export function chartCategories(data: ChartDatum[]): ChartDatum[] {
  const valid = data.filter((d) => Number.isFinite(d.value) && d.value >= 0);
  if (valid.length <= chartSeriesLimit) return valid;
  return [
    ...valid.slice(0, chartSeriesLimit - 1),
    {
      label: 'Other',
      value: valid
        .slice(chartSeriesLimit - 1)
        .reduce((sum, d) => sum + d.value, 0),
    },
  ];
}
const WIDTH = 320,
  HEIGHT = 160,
  INSET = 12;
function ChartFrame({
  label,
  data,
  children,
}: {
  label: string;
  data: ChartDatum[];
  children: React.ReactNode;
}) {
  return (
    <Surface>
      <Typography role="caption" accessibilityRole="header">
        {label}
      </Typography>
      {data.length ? (
        <>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${label}. ${data.map((d) => `${d.label}: ${d.value}`).join('; ')}`}
          >
            {children}
          </View>
          <Collapsible title="View chart data">
            <Table
              label={label}
              columns={[
                { key: 'label', label: 'Label' },
                { key: 'value', label: 'Value', numeric: true },
              ]}
              rows={data.map((d, i) => ({
                id: String(i),
                values: { label: d.label, value: String(d.value) },
              }))}
            />
          </Collapsible>
        </>
      ) : (
        <Typography muted>No data available</Typography>
      )}
    </Surface>
  );
}
export function BarChart({
  label,
  data,
}: {
  label: string;
  data: ChartDatum[];
}) {
  const t = useAppTheme(),
    palette = chartSeries[t.dark ? 'dark' : 'light'];
  const values = chartCategories(data),
    max = Math.max(1, ...values.map((d) => d.value));
  return (
    <ChartFrame label={label} data={values}>
      <Svg width="100%" height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        {values.map((d, i) => {
          const width = (WIDTH - INSET * 2) / values.length,
            height = (d.value / max) * (HEIGHT - INSET * 2);
          return (
            <Rect
              key={i}
              x={INSET + i * width}
              y={HEIGHT - INSET - height}
              width={width * 0.7}
              height={height}
              fill={palette[i]}
            />
          );
        })}
      </Svg>
    </ChartFrame>
  );
}
export function BarList({
  label,
  data,
}: {
  label: string;
  data: ChartDatum[];
}) {
  const t = useAppTheme(),
    palette = chartSeries[t.dark ? 'dark' : 'light'];
  const values = chartCategories(data),
    max = Math.max(1, ...values.map((d) => d.value));
  return (
    <Surface>
      <Typography role="caption" accessibilityRole="header">
        {label}
      </Typography>
      {values.length === 0 && <Typography muted>No data available</Typography>}
      {values.map((d, i) => (
        <View key={i} style={{ gap: t.spacing[1] }}>
          <Typography role="caption">
            {d.label}: {d.value}
          </Typography>
          <View
            style={{
              height: t.spacing[2],
              backgroundColor: t.colors.surface.secondary,
              borderRadius: t.borderRadius.full,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                height: '100%',
                width: `${(d.value / max) * 100}%`,
                backgroundColor: palette[i],
              }}
            />
          </View>
        </View>
      ))}
    </Surface>
  );
}
export function DonutChart({
  label,
  data,
}: {
  label: string;
  data: ChartDatum[];
}) {
  const t = useAppTheme(),
    palette = chartSeries[t.dark ? 'dark' : 'light'];
  const values = chartCategories(data),
    total = values.reduce((sum, d) => sum + d.value, 0),
    circumference = 2 * Math.PI * 55;
  let offset = 0;
  return (
    <ChartFrame label={label} data={values}>
      <Svg width="100%" height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <Circle
          cx={WIDTH / 2}
          cy={HEIGHT / 2}
          r={55}
          stroke={t.colors.surface.secondary}
          strokeWidth={22}
          fill="none"
        />
        {total > 0 &&
          values.map((d, i) => {
            const length = (d.value / total) * circumference,
              start = offset;
            offset += length;
            return (
              <Circle
                key={i}
                cx={WIDTH / 2}
                cy={HEIGHT / 2}
                r={55}
                stroke={palette[i]}
                strokeWidth={22}
                fill="none"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-start}
                rotation={-90}
                origin={`${WIDTH / 2}, ${HEIGHT / 2}`}
              />
            );
          })}
      </Svg>
    </ChartFrame>
  );
}
export function LineChart({
  label,
  data,
  compact = false,
}: {
  label: string;
  data: ChartDatum[];
  compact?: boolean;
}) {
  const t = useAppTheme(),
    values = data.filter((d) => Number.isFinite(d.value));
  const plotHeight = compact ? t.spacing[12] : HEIGHT;
  const min = Math.min(0, ...values.map((d) => d.value)),
    max = Math.max(1, ...values.map((d) => d.value));
  const points = values.map((d, i) => ({
    x: INSET + (i / Math.max(1, values.length - 1)) * (WIDTH - INSET * 2),
    y:
      plotHeight -
      INSET -
      ((d.value - min) / (max - min)) * (plotHeight - INSET * 2),
  }));
  const color = chartSeries[t.dark ? 'dark' : 'light'][0];
  return (
    <ChartFrame label={label} data={values}>
      <Svg
        width="100%"
        height={plotHeight}
        viewBox={`0 0 ${WIDTH} ${plotHeight}`}
      >
        <Polyline
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={3}
        />
        {points.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />
        ))}
      </Svg>
    </ChartFrame>
  );
}
export function Sparkline(props: { label: string; data: ChartDatum[] }) {
  return <LineChart {...props} compact />;
}
export function Meter({
  label,
  value,
  max = 100,
}: {
  label: string;
  value: number;
  max?: number;
}) {
  const t = useAppTheme();
  const valid = Number.isFinite(value) && Number.isFinite(max) && max > 0;
  const clamped = valid ? Math.max(0, Math.min(max, value)) : 0;
  return (
    <View style={{ gap: t.spacing[2] }}>
      <Typography role="caption">
        {label}: {valid ? `${value} / ${max}` : 'Unavailable'}
      </Typography>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={
          valid ? { min: 0, max, now: clamped } : { text: 'Unavailable' }
        }
        style={{
          height: t.spacing[2],
          borderRadius: t.borderRadius.full,
          backgroundColor: t.colors.surface.secondary,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            height: '100%',
            width: `${valid ? (clamped / max) * 100 : 0}%`,
            backgroundColor: t.colors.primary[500],
          }}
        />
      </View>
    </View>
  );
}
export interface ScatterSeries {
  label: string;
  points: { x: number; y: number }[];
}
export function ScatterChart({
  label,
  series,
}: {
  label: string;
  series: ScatterSeries[];
}) {
  const t = useAppTheme();
  if (series.length > chartScatterSeriesLimit)
    return (
      <Surface>
        <Typography>
          {label}: choose at most {chartScatterSeriesLimit} series.
        </Typography>
      </Surface>
    );
  const points = series.flatMap((s, i) =>
    s.points
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => ({ ...p, series: i, label: s.label }))
  );
  const minX = Math.min(0, ...points.map((p) => p.x)),
    maxX = Math.max(1, ...points.map((p) => p.x));
  const minY = Math.min(0, ...points.map((p) => p.y)),
    maxY = Math.max(1, ...points.map((p) => p.y));
  return (
    <ChartFrame
      label={label}
      data={points.map((p) => ({ label: `${p.label}, x ${p.x}`, value: p.y }))}
    >
      <Svg width="100%" height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        {points.map((p, i) => (
          <Circle
            key={i}
            cx={INSET + ((p.x - minX) / (maxX - minX)) * (WIDTH - 2 * INSET)}
            cy={
              HEIGHT -
              INSET -
              ((p.y - minY) / (maxY - minY)) * (HEIGHT - 2 * INSET)
            }
            r={4}
            fill={chartSeries[t.dark ? 'dark' : 'light'][p.series]}
          />
        ))}
      </Svg>
    </ChartFrame>
  );
}
export interface TrendBucket {
  label: string;
  values: number[];
}
export function TrendChart({
  label,
  series,
  buckets,
}: {
  label: string;
  series: string[];
  buckets: TrendBucket[];
}) {
  const t = useAppTheme();
  const normalized = buckets.map((bucket) => ({
    label: bucket.label,
    categories: chartCategories(
      series.map((name, i) => ({
        label: name,
        value: Math.max(
          0,
          Number.isFinite(bucket.values[i]) ? bucket.values[i] : 0
        ),
      }))
    ),
  }));
  const max = Math.max(
    1,
    ...normalized.map((b) => b.categories.reduce((sum, c) => sum + c.value, 0))
  );
  return (
    <ChartFrame
      label={label}
      data={normalized.flatMap((b) =>
        b.categories.map((c) => ({
          label: `${b.label}, ${c.label}`,
          value: c.value,
        }))
      )}
    >
      <Svg width="100%" height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        {normalized.flatMap((b, i) => {
          let y = HEIGHT - INSET;
          const width = (WIDTH - 2 * INSET) / normalized.length;
          return b.categories.map((c, j) => {
            const height = (c.value / max) * (HEIGHT - 2 * INSET);
            y -= height;
            return (
              <Rect
                key={`${i}-${j}`}
                x={INSET + i * width}
                y={y}
                width={width * 0.7}
                height={height}
                fill={chartSeries[t.dark ? 'dark' : 'light'][j]}
              />
            );
          });
        })}
      </Svg>
    </ChartFrame>
  );
}
