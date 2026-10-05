import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useAppTheme } from '../../theme/ThemeProvider';
import { Button } from '../Button';
import { EmptyState } from '../EmptyState';
import { Typography } from './typography';
import { Collapsible, FormField, Surface } from './surfaces';
import { NoticeBar } from './overlays';

export interface QueryErrorView {
  title: string;
  message: string;
  tone: 'danger' | 'info';
  retryable: boolean;
}
export function QueryState({
  isLoading,
  error,
  isEmpty,
  children,
  onRetry,
  classifyError,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  loadingLabel = 'Loading',
}: {
  isLoading?: boolean;
  error?: unknown;
  isEmpty?: boolean;
  children?: React.ReactNode;
  onRetry?: () => void;
  classifyError?: (error: unknown) => QueryErrorView;
  emptyTitle?: string;
  emptyDescription?: string;
  loadingLabel?: string;
}) {
  const t = useAppTheme();
  if (isLoading)
    return (
      <ActivityIndicator
        accessibilityLabel={loadingLabel}
        accessibilityState={{ busy: true }}
        color={t.colors.primary[500]}
      />
    );
  if (error) {
    const view = classifyError?.(error) ?? {
      title: 'Could not load',
      message:
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Something went wrong.',
      tone: 'danger',
      retryable: true,
    };
    return (
      <NoticeBar tone={view.tone}>
        <Typography accessibilityRole="header">{view.title}</Typography>
        <Typography>{view.message}</Typography>
        {view.retryable && onRetry && (
          <Button title="Try again" variant="secondary" onPress={onRetry} />
        )}
      </NoticeBar>
    );
  }
  if (isEmpty)
    return <EmptyState title={emptyTitle} message={emptyDescription} />;
  return <>{children}</>;
}
export function RecordList({ children }: { children: React.ReactNode }) {
  const t = useAppTheme();
  return <View style={{ gap: t.spacing[2] }}>{children}</View>;
}
export function RecordItem({
  title,
  description,
  leading,
  trailing,
  onPress,
  children,
}: {
  title: string;
  description?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onPress?: () => void;
  children?: React.ReactNode;
}) {
  const t = useAppTheme();
  const content = (
    <Surface>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.spacing[3],
        }}
      >
        {leading}
        <View style={{ flex: 1, gap: t.spacing[1] }}>
          <Typography>{title}</Typography>
          {description && (
            <Typography role="caption" muted>
              {description}
            </Typography>
          )}
        </View>
        {trailing}
      </View>
      {children}
    </Surface>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {content}
    </Pressable>
  ) : (
    content
  );
}
export function RecordField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View>
      <Typography role="eyebrow" muted>
        {label}
      </Typography>
      <Typography selectable>{value}</Typography>
    </View>
  );
}
export function FilterBar({
  children,
  activeCount = 0,
  onClear,
}: {
  children: React.ReactNode;
  activeCount?: number;
  onClear?: () => void;
}) {
  const t = useAppTheme();
  return (
    <View style={{ gap: t.spacing[2] }}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: t.spacing[2],
        }}
      >
        {children}
      </View>
      {activeCount > 0 && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.spacing[2],
          }}
        >
          <Typography role="caption" muted>
            {activeCount} active {activeCount === 1 ? 'filter' : 'filters'}
          </Typography>
          {onClear && (
            <Button
              title="Clear filters"
              variant="ghost"
              size="sm"
              onPress={onClear}
            />
          )}
        </View>
      )}
    </View>
  );
}
export function Pager({
  offset,
  limit,
  returned,
  onOffsetChange,
  noun = 'rows',
  busy = false,
}: {
  offset: number;
  limit: number;
  returned: number;
  onOffsetChange: (offset: number) => void;
  noun?: string;
  busy?: boolean;
}) {
  const t = useAppTheme();
  const hasPrevious = offset > 0,
    hasNext = limit > 0 && returned === limit;
  if (!hasPrevious && !hasNext) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: t.spacing[2],
      }}
    >
      <Button
        title="Previous"
        variant="secondary"
        disabled={busy || !hasPrevious}
        onPress={() => onOffsetChange(Math.max(0, offset - limit))}
      />
      <Typography role="caption" accessibilityLiveRegion="polite">
        {noun} {returned ? offset + 1 : offset}–{offset + returned}
      </Typography>
      <Button
        title="Next"
        variant="secondary"
        disabled={busy || !hasNext}
        onPress={() => onOffsetChange(offset + limit)}
      />
    </View>
  );
}
export interface DateRange {
  from: string;
  to: string;
}
export function dateRangeError(value: DateRange): string | undefined {
  const valid = (s: string) =>
    !s ||
    (/^\d{4}-\d{2}-\d{2}$/.test(s) &&
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s);
  if (!valid(value.from) || !valid(value.to))
    return 'Use a valid date in YYYY-MM-DD format.';
  if (value.from && value.to && value.from > value.to)
    return 'The end date must be on or after the start date.';
}
/** Controlled text dates avoid introducing a native dependency. Validation is visible before refresh. */
export function DateRangeFilter({
  value,
  onChange,
  onRefresh,
  isRefreshing,
}: {
  value: DateRange;
  onChange: (value: DateRange) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}) {
  const error = dateRangeError(value);
  return (
    <RecordList>
      <FormField
        label="From"
        placeholder="YYYY-MM-DD"
        value={value.from}
        onChangeText={(from) => onChange({ ...value, from })}
        autoCapitalize="none"
      />
      <FormField
        label="To"
        placeholder="YYYY-MM-DD"
        value={value.to}
        onChangeText={(to) => onChange({ ...value, to })}
        error={error}
        autoCapitalize="none"
      />
      <Button
        title="Clear dates"
        variant="ghost"
        disabled={!value.from && !value.to}
        onPress={() => onChange({ from: '', to: '' })}
      />
      {onRefresh && (
        <Button
          title="Refresh"
          disabled={!!error || isRefreshing}
          loading={isRefreshing}
          onPress={onRefresh}
        />
      )}
    </RecordList>
  );
}
export function ValueList({
  values,
  singular,
  plural = `${singular}s`,
  emptyLabel = 'None',
  defaultOpen,
}: {
  values: string[];
  singular: string;
  plural?: string;
  emptyLabel?: string;
  defaultOpen?: boolean;
}) {
  return values.length ? (
    <Collapsible
      title={`${values.length} ${values.length === 1 ? singular : plural}`}
      defaultOpen={defaultOpen}
    >
      <RecordList>
        {values.map((value, i) => (
          <Typography key={i} selectable mono>
            {value}
          </Typography>
        ))}
      </RecordList>
    </Collapsible>
  ) : (
    <Typography muted>{emptyLabel}</Typography>
  );
}
export interface TimelineEvent {
  id: string;
  title: string;
  timestamp: string;
  description?: string;
}
export function EventTimeline({
  events,
  label,
}: {
  events: TimelineEvent[];
  label: string;
}) {
  return (
    <View>
      <Typography accessibilityRole="header" role="eyebrow" muted>
        {label}
      </Typography>
      <RecordList>
        {events.map((event) => (
          <RecordItem
            key={event.id}
            title={event.title}
            description={event.description}
            trailing={
              <Typography role="tiny" muted>
                {event.timestamp}
              </Typography>
            }
          />
        ))}
      </RecordList>
    </View>
  );
}
export interface TableColumn {
  key: string;
  label: string;
  numeric?: boolean;
}
/** Horizontal scrolling retains column headings on narrow screens; cells expose their heading to readers. */
export function Table({
  columns,
  rows,
  label,
}: {
  columns: TableColumn[];
  rows: { id: string; values: Record<string, string> }[];
  label: string;
}) {
  const t = useAppTheme();
  return (
    <View>
      <Typography accessibilityRole="header" role="caption">
        {label}
      </Typography>
      <ScrollView horizontal>
        <View>
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: t.colors.surface.elevated,
            }}
          >
            {columns.map((col) => (
              <View key={col.key} style={{ width: 160, padding: t.spacing[3] }}>
                <Typography role="caption" accessibilityRole="header">
                  {col.label}
                </Typography>
              </View>
            ))}
          </View>
          {rows.map((row) => (
            <View
              key={row.id}
              style={{
                flexDirection: 'row',
                borderBottomWidth: 1,
                borderColor: t.colors.border.light,
              }}
            >
              {columns.map((col) => (
                <View
                  key={col.key}
                  style={{ width: 160, padding: t.spacing[3] }}
                >
                  <Typography
                    accessibilityLabel={`${col.label}: ${row.values[col.key] ?? ''}`}
                    mono={col.numeric}
                    selectable
                  >
                    {row.values[col.key] ?? ''}
                  </Typography>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
