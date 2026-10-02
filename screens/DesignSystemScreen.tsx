import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppThemeProvider, useAppTheme } from '../theme/ThemeProvider';
import { darkTheme, lightTheme } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button } from '../components/Button';
import { SegmentedTabs } from '../components/SegmentedTabs';
import {
  Avatar,
  BarChart,
  BarList,
  CodeBlock,
  DateRangeFilter,
  Dialog,
  DonutChart,
  DrawerNavGroup,
  DropdownMenu,
  EventTimeline,
  FilterBar,
  FloatingNotice,
  FormField,
  LineChart,
  Meter,
  MetricCard,
  NoticeBar,
  PageHeader,
  Pager,
  Popover,
  QueryState,
  RecordItem,
  RecordList,
  ScatterChart,
  Sparkline,
  SummaryRows,
  Surface,
  ToneBadge,
  TrendChart,
  Typography,
  ValueList,
} from '../components/ui';

/** Development-only catalogue; examples never read wallet data or submit payments. */
export default function DesignSystemScreen() {
  const [mode, setMode] = useState<'dark' | 'light'>('dark');
  return (
    <AppThemeProvider theme={mode === 'dark' ? darkTheme : lightTheme}>
      <Catalogue mode={mode} onMode={setMode} />
    </AppThemeProvider>
  );
}
function Catalogue({
  mode,
  onMode,
}: {
  mode: 'dark' | 'light';
  onMode: (mode: 'dark' | 'light') => void;
}) {
  const t = useAppTheme();
  const [dialog, setDialog] = useState<'dialog' | 'popover' | 'menu' | null>(
    null
  );
  const [query, setQuery] = useState<'loaded' | 'loading' | 'empty' | 'error'>(
    'loaded'
  );
  const [date, setDate] = useState({ from: '', to: '' });
  const [text, setText] = useState('');
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState(false);
  const sample = [
    { label: 'A', value: 4 },
    { label: 'B', value: 7 },
    { label: 'C', value: 2 },
  ];
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: t.colors.background.primary }}
    >
      <ScreenHeader title="Component preview" />
      <ScrollView
        contentContainerStyle={{
          padding: t.spacing[4],
          gap: t.spacing[4],
          paddingBottom: t.spacing[24],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <PageHeader
          eyebrow="Kaleido UI"
          title="Mobile components"
          description="Example data for reviewing layout, text scaling and interaction."
        />
        <SegmentedTabs
          value={mode}
          onChange={onMode}
          options={[
            { key: 'dark', label: 'Dark' },
            { key: 'light', label: 'Light' },
          ]}
        />
        <Surface>
          <Typography role="display">Display</Typography>
          <Typography role="headline">Headline</Typography>
          <Typography role="title">Title</Typography>
          <Typography role="subhead">Subheading</Typography>
          <Typography>Body text</Typography>
          <Typography role="caption" muted>
            Caption
          </Typography>
          <Typography role="eyebrow" muted>
            Eyebrow label
          </Typography>
        </Surface>
        <MetricCard
          label="Example metric"
          value="12,345"
          description="Sample value"
          tone="primary"
        />
        <SummaryRows
          rows={[
            { label: 'Example total', value: '12,345 sats', emphasis: true },
            {
              label: 'Status',
              value: 'Pending',
              tone: 'warning',
              hint: 'Example status',
            },
          ]}
        />
        <Surface>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: t.spacing[2],
            }}
          >
            {(
              [
                'primary',
                'success',
                'warning',
                'danger',
                'info',
                'muted',
              ] as const
            ).map((tone) => (
              <ToneBadge key={tone} label={tone} tone={tone} />
            ))}
          </View>
        </Surface>
        <FormField
          label="Example field"
          hint="Type to check the keyboard and focus."
          value={text}
          onChangeText={setText}
        />
        <FormField
          label="Invalid field"
          error="This is an example validation message."
        />
        <NoticeBar tone="warning">Example inline notice</NoticeBar>
        <Button title="Show floating notice" onPress={() => setNotice(true)} />
        <Button title="Open dialog" onPress={() => setDialog('dialog')} />
        <Button
          title="Open menu"
          variant="secondary"
          onPress={() => setDialog('menu')}
        />
        <Button
          title="Open popover sheet"
          variant="secondary"
          onPress={() => setDialog('popover')}
        />
        <FilterBar
          activeCount={query === 'loaded' ? 0 : 1}
          onClear={() => setQuery('loaded')}
        >
          <SegmentedTabs
            value={query}
            onChange={setQuery}
            options={['loaded', 'loading', 'empty', 'error'].map((key) => ({
              key: key as typeof query,
              label: key,
            }))}
          />
        </FilterBar>
        <QueryState
          isLoading={query === 'loading'}
          isEmpty={query === 'empty'}
          error={
            query === 'error' ? new Error('Example read failure') : undefined
          }
          onRetry={() => setQuery('loaded')}
        >
          <RecordList>
            <RecordItem
              title="Example contact"
              description="A record with an avatar"
              leading={<Avatar name="Kaleido Wallet" />}
              trailing={<ToneBadge label="Ready" tone="success" />}
            />
          </RecordList>
        </QueryState>
        <Pager
          offset={page}
          limit={10}
          returned={page < 20 ? 10 : 3}
          onOffsetChange={setPage}
        />
        <DateRangeFilter value={date} onChange={setDate} />
        <ValueList singular="value" values={['Example A', 'Example B']} />
        <EventTimeline
          label="Example timeline"
          events={[
            { id: '1', title: 'Created', timestamp: '09:00' },
            { id: '2', title: 'Completed', timestamp: '09:01' },
          ]}
        />
        <CodeBlock code="Example public reference" />
        <BarChart label="Example bars" data={sample} />
        <BarList label="Example bar list" data={sample} />
        <DonutChart label="Example distribution" data={sample} />
        <LineChart label="Example trend" data={sample} />
        <Sparkline label="Example sparkline" data={sample} />
        <Meter label="Example progress" value={65} />
        <ScatterChart
          label="Example scatter"
          series={[
            {
              label: 'A',
              points: [
                { x: 1, y: 2 },
                { x: 2, y: 4 },
              ],
            },
          ]}
        />
        <TrendChart
          label="Example stacked trend"
          series={['A', 'B']}
          buckets={[
            { label: 'One', values: [2, 3] },
            { label: 'Two', values: [3, 4] },
          ]}
        />
      </ScrollView>
      <Dialog
        visible={dialog === 'dialog'}
        title="Example dialog"
        onClose={() => setDialog(null)}
      >
        <Typography>Android back and Close dismiss this dialog.</Typography>
        <Button title="Done" onPress={() => setDialog(null)} />
      </Dialog>
      <Popover
        visible={dialog === 'popover'}
        title="Example sheet"
        onClose={() => setDialog(null)}
      >
        <DrawerNavGroup
          title="Navigation"
          selectedId="one"
          items={[
            { id: 'one', label: 'First item' },
            { id: 'two', label: 'Second item' },
          ]}
          onSelect={() => setDialog(null)}
        />
      </Popover>
      <DropdownMenu
        visible={dialog === 'menu'}
        title="Example menu"
        onClose={() => setDialog(null)}
        items={[
          {
            id: 'copy',
            label: 'Example action',
            onPress: () => setNotice(true),
          },
          {
            id: 'disabled',
            label: 'Unavailable action',
            disabled: true,
            onPress: () => {},
          },
        ]}
      />
      {notice && (
        <FloatingNotice onDismiss={() => setNotice(false)}>
          Example floating notice
        </FloatingNotice>
      )}
    </SafeAreaView>
  );
}
