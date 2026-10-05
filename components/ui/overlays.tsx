import React, { useRef } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../theme/ThemeProvider';
import { Typography } from './typography';
import { Surface, Tone, useTone } from './surfaces';

export interface DialogProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  showClose?: boolean;
  presentation?: 'dialog' | 'sheet';
}
/** A native Modal owns focus and Android back handling; drawers/popovers become sheets on mobile. */
export function Dialog({
  visible,
  title,
  onClose,
  children,
  showClose = true,
  presentation = 'dialog',
}: DialogProps) {
  const t = useAppTheme(),
    insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const heading = useRef<View>(null);
  const focusHeading = () => {
    // React Native Web's Modal manages DOM focus; findNodeHandle is native-only.
    if (Platform.OS === 'web') return;
    const node = findNodeHandle(heading.current);
    if (node != null) AccessibilityInfo.setAccessibilityFocus(node);
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={focusHeading}
    >
      <View
        style={{
          flex: 1,
          justifyContent: presentation === 'sheet' ? 'flex-end' : 'center',
          padding: presentation === 'sheet' ? 0 : t.spacing[4],
          paddingTop: insets.top,
          backgroundColor: t.colors.background.backdrop,
        }}
      >
        <Pressable
          accessibilityLabel={`Dismiss ${title}`}
          accessibilityRole="button"
          onPress={onClose}
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
        />
        <Surface
          accessibilityViewIsModal
          style={{
            maxHeight: height - insets.top - t.spacing[8],
            paddingBottom: Math.max(insets.bottom, t.spacing[4]),
            borderRadius: t.borderRadius.lg,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.spacing[3],
            }}
          >
            <View
              ref={heading}
              accessible
              accessibilityRole="header"
              accessibilityLabel={title}
              style={{ flex: 1 }}
            >
              <Typography role="title">{title}</Typography>
            </View>
            {showClose && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Close ${title}`}
                onPress={onClose}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Typography>×</Typography>
              </Pressable>
            )}
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: t.spacing[3] }}
          >
            {children}
          </ScrollView>
        </Surface>
      </View>
    </Modal>
  );
}
export function Drawer(props: Omit<DialogProps, 'presentation'>) {
  return <Dialog {...props} presentation="sheet" />;
}
export const Popover = Drawer;

export interface MenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  onPress: () => void;
}
export function DropdownMenu({
  items,
  ...props
}: Omit<DialogProps, 'children' | 'presentation'> & { items: MenuItem[] }) {
  const t = useAppTheme();
  return (
    <Drawer {...props}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityState={{ disabled: !!item.disabled }}
          disabled={item.disabled}
          onPress={() => {
            props.onClose();
            item.onPress();
          }}
          style={{
            minHeight: 44,
            justifyContent: 'center',
            padding: t.spacing[3],
            borderRadius: t.borderRadius.md,
            backgroundColor: t.colors.surface.secondary,
          }}
        >
          <Typography
            style={{
              color: item.disabled
                ? t.colors.text.disabled
                : item.destructive
                  ? t.colors.error[500]
                  : t.colors.text.primary,
            }}
          >
            {item.label}
          </Typography>
        </Pressable>
      ))}
    </Drawer>
  );
}
export function DrawerNavGroup({
  title,
  items,
  selectedId,
  onSelect,
}: {
  title: string;
  items: { id: string; label: string; disabled?: boolean }[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const t = useAppTheme();
  return (
    <View style={{ gap: t.spacing[2] }}>
      <Typography role="eyebrow" muted>
        {title}
      </Typography>
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityState={{
            selected: item.id === selectedId,
            disabled: !!item.disabled,
          }}
          disabled={item.disabled}
          onPress={() => onSelect(item.id)}
          style={{
            padding: t.spacing[3],
            minHeight: 44,
            borderRadius: t.borderRadius.md,
            backgroundColor:
              item.id === selectedId
                ? t.colors.primary[50]
                : t.colors.surface.secondary,
          }}
        >
          <Typography
            style={{
              color: item.disabled
                ? t.colors.text.disabled
                : item.id === selectedId
                  ? t.colors.primary[500]
                  : t.colors.text.primary,
            }}
          >
            {item.label}
          </Typography>
        </Pressable>
      ))}
    </View>
  );
}
export function NoticeBar({
  children,
  tone = 'info',
  hidden = false,
  onDismiss,
}: {
  children: React.ReactNode;
  tone?: Tone;
  hidden?: boolean;
  onDismiss?: () => void;
}) {
  const t = useAppTheme(),
    accent = useTone(tone);
  if (hidden) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole={
        tone === 'danger' || tone === 'warning' ? 'alert' : undefined
      }
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing[3],
        padding: t.spacing[3],
        borderRadius: t.borderRadius.md,
        borderWidth: 1,
        borderColor: accent + '44',
        backgroundColor: accent + '26',
      }}
    >
      <View style={{ flex: 1 }}>
        {typeof children === 'string' ? (
          <Typography>{children}</Typography>
        ) : (
          children
        )}
      </View>
      {onDismiss && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss notice"
          onPress={onDismiss}
          style={{
            minHeight: 44,
            minWidth: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Typography>×</Typography>
        </Pressable>
      )}
    </View>
  );
}
/** Host inside the screen's safe-area layout so it cannot cover the system navigation bar. */
export function FloatingNotice(props: React.ComponentProps<typeof NoticeBar>) {
  const t = useAppTheme();
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        bottom: t.spacing[4],
        left: t.spacing[4],
        right: t.spacing[4],
      }}
    >
      <NoticeBar {...props} />
    </View>
  );
}
