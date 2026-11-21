import { FeaturePeriod } from '../constants/features';
import { t } from './i18n';

/** "₹200 / year" or "Free for now", in the chosen language. (constants/features.ts has the plain English one the server shares.) */
export const priceText = (price: number, period: FeaturePeriod): string => (price > 0 ? t('₹{0} / {1}', { 0: price, 1: period }) : t('Free for now'));
