import React from 'react';
import { Pressable, PressableProps } from 'react-native';
import { Tabs, Redirect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../../context/AuthContext';
import { COLORS } from '../../constants/theme';
import { useLanguage } from '../../context/LanguageContext';
import { t } from '../../utils/i18n';
import { useTourTarget } from '../../context/TourTargetsContext';

// A tab-bar button that the guided tour can point at. It is the ordinary button with a name attached.
const TourTab: React.FC<{ id: string; props: unknown }> = ({ id, props }) => {
  const ref = useTourTarget(id);
  return <Pressable ref={ref} {...(props as PressableProps)} />;
};
const tourTab = (id: string) => (props: unknown) => <TourTab id={id} props={props} />;

export default function TabsLayout() {
  const { user, isLoading, hasFeature } = useAuth();
  useLanguage(); // re-render the tab titles when the language changes

  if (isLoading) return null;
  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs
      // Back after a tap-through (Home or Reports to a filtered list) returns to the tab you came from.
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.accent,
        tabBarInactiveTintColor: COLORS.textDim,
        tabBarStyle: {
          backgroundColor: COLORS.card,
          borderTopColor: COLORS.cardBorder,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('Dashboard'),
          tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: t('Transactions'),
          tabBarButton: tourTab('tab-transactions'),
          tabBarIcon: ({ color, size }) => <Ionicons name="swap-horizontal" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="loans"
        options={{
          // Hidden until staff switch the feature on for this user; the route still exists for old links.
          // expo-router refuses `href` and `tabBarButton` together, so a hidden tab sets only `href`.
          ...(hasFeature('loans') ? { tabBarButton: tourTab('tab-loans') } : { href: null }),
          title: t('Loans'),
          tabBarIcon: ({ color, size }) => <Ionicons name="card" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="investments"
        options={{
          // Hidden until staff switch the feature on for this user; the route still exists for old links.
          // expo-router refuses `href` and `tabBarButton` together, so a hidden tab sets only `href`.
          ...(hasFeature('investments') ? { tabBarButton: tourTab('tab-investments') } : { href: null }),
          title: t('Investments'),
          tabBarIcon: ({ color, size }) => <Ionicons name="trending-up" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          // Hidden until staff switch the feature on for this user; the route still exists for old links.
          // expo-router refuses `href` and `tabBarButton` together, so a hidden tab sets only `href`.
          ...(hasFeature('goals') ? { tabBarButton: tourTab('tab-goals') } : { href: null }),
          title: t('Goals'),
          tabBarIcon: ({ color, size }) => <Ionicons name="flag" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: t('Reports'),
          tabBarButton: tourTab('tab-reports'),
          tabBarIcon: ({ color, size }) => <Ionicons name="bar-chart" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
