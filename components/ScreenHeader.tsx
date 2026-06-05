import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { MainHeader } from './MainHeader';

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  rightAction?: React.ReactNode;
  icon?: React.ComponentProps<typeof MainHeader>['icon'];
  showBack?: boolean;
  children?: React.ReactNode;
};

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  title,
  subtitle,
  rightAction,
  icon,
  showBack,
  children,
}) => {
  const navigation = useNavigation<any>();
  const canGoBack = navigation?.canGoBack?.() ?? false;
  const shouldShowBack = showBack ?? canGoBack;

  return (
    <MainHeader
      title={title}
      subtitle={subtitle}
      icon={icon}
      rightAction={rightAction}
      onBack={shouldShowBack ? () => navigation.goBack() : undefined}
    >
      {children}
    </MainHeader>
  );
};

export default ScreenHeader;


