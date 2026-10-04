export type CategoryType = 'income' | 'expense';

export interface Category {
  key: string;
  label: string;
  icon: string;
  color: string;
  group: string;
  type: CategoryType;
  // Present on categories fetched from the server (context/CategoriesContext.tsx);
  // absent on the static seed list below, which is system-only by definition.
  isCustom?: boolean;
}

export const EXPENSE_CATEGORIES: Category[] = [
  // Household
  { key: 'maid', label: 'Maid', icon: '🧹', color: '#34D399', group: 'Household', type: 'expense' },
  { key: 'car_wash', label: 'Car wash', icon: '🚗', color: '#38BDF8', group: 'Household', type: 'expense' },
  { key: 'electricity_laundry', label: 'Electricity & laundry', icon: '⚡', color: '#FCD34D', group: 'Household', type: 'expense' },
  { key: 'mobile_recharge', label: 'Mobile recharge', icon: '📱', color: '#F9A8D4', group: 'Household', type: 'expense' },
  { key: 'internet', label: 'Internet', icon: '📶', color: '#818CF8', group: 'Household', type: 'expense' },
  { key: 'tv_subscriptions', label: 'TV / subscriptions', icon: '📺', color: '#C084FC', group: 'Household', type: 'expense' },
  { key: 'property_tax', label: 'Property tax & expense', icon: '🏠', color: '#93C5FD', group: 'Household', type: 'expense' },

  // Food & dining
  { key: 'groceries_milk', label: 'Groceries & milk', icon: '🛒', color: '#34D399', group: 'Food & dining', type: 'expense' },
  { key: 'lunch_dinner', label: 'Lunch / dinner', icon: '🍽️', color: '#FB923C', group: 'Food & dining', type: 'expense' },
  { key: 'veg_nonveg_fruits', label: 'Vegetables, non-veg & fruits', icon: '🥦', color: '#4ADE80', group: 'Food & dining', type: 'expense' },

  // Transport
  { key: 'fuel_petrol', label: 'Fuel / petrol', icon: '⛽', color: '#FBBF24', group: 'Transport', type: 'expense' },
  { key: 'car_bike_maintenance', label: 'Car & bike maintenance', icon: '🔧', color: '#A78BFA', group: 'Transport', type: 'expense' },
  { key: 'travel', label: 'Travel', icon: '✈️', color: '#60A5FA', group: 'Transport', type: 'expense' },

  // Health & protection
  { key: 'medicine', label: 'Medicine', icon: '💊', color: '#F87171', group: 'Health & protection', type: 'expense' },
  { key: 'life_insurance', label: 'Life insurance', icon: '🛡️', color: '#34D399', group: 'Health & protection', type: 'expense' },
  { key: 'insurance_other', label: 'Insurance (other)', icon: '📋', color: '#6EE7B7', group: 'Health & protection', type: 'expense' },

  // Family & education
  { key: 'school_tuition', label: 'School / tuition fees', icon: '🎓', color: '#FCD34D', group: 'Family & education', type: 'expense' },
  { key: 'parents_care', label: 'Parents care', icon: '👴', color: '#F9A8D4', group: 'Family & education', type: 'expense' },

  // Loans & EMIs
  { key: 'loan_emi', label: 'Loan EMI', icon: '🏦', color: '#3B82F6', group: 'Loans & EMIs', type: 'expense' },
  { key: 'loan_part_payment', label: 'Loan part payment', icon: '💵', color: '#1D4ED8', group: 'Loans & EMIs', type: 'expense' },
  { key: 'gold_loan', label: 'Gold loan', icon: '🥇', color: '#FBBF24', group: 'Loans & EMIs', type: 'expense' },
  { key: 'external_emis', label: 'External EMIs', icon: '💳', color: '#FB923C', group: 'Loans & EMIs', type: 'expense' },

  // Credit cards
  { key: 'credit_card_bill', label: 'Credit card bill', icon: '💳', color: '#F87171', group: 'Credit cards', type: 'expense' },

  // Shopping & misc
  { key: 'shopping', label: 'Shopping', icon: '🛍️', color: '#C084FC', group: 'Shopping & misc', type: 'expense' },
  { key: 'misc_expenses', label: 'Misc expenses', icon: '🔮', color: '#9CA3AF', group: 'Shopping & misc', type: 'expense' },
  { key: 'office_expenses', label: 'Office expenses', icon: '🖥️', color: '#818CF8', group: 'Shopping & misc', type: 'expense' },
  { key: 'donation', label: 'Donation', icon: '🙏', color: '#86EFAC', group: 'Shopping & misc', type: 'expense' },
  { key: 'entertainment', label: 'Entertainment', icon: '🎬', color: '#F472B6', group: 'Shopping & misc', type: 'expense' },
  { key: 'gov_administration', label: 'Gov administration', icon: '🏛️', color: '#6B7280', group: 'Shopping & misc', type: 'expense' },

  // Property & farming
  { key: 'farm_home_renovation', label: 'Farm / home renovation', icon: '🏗️', color: '#FB923C', group: 'Property & farming', type: 'expense' },
  { key: 'farm_expenses', label: 'Farm expenses', icon: '🌾', color: '#4ADE80', group: 'Property & farming', type: 'expense' },

  // Investments & savings
  { key: 'mutual_funds', label: 'Mutual funds (SIP)', icon: '📈', color: '#10B981', group: 'Investments & savings', type: 'expense' },
  { key: 'fixed_deposit', label: 'Fixed deposit (FD)', icon: '🏦', color: '#34D399', group: 'Investments & savings', type: 'expense' },
  { key: 'bonds', label: 'Bonds', icon: '📊', color: '#6EE7B7', group: 'Investments & savings', type: 'expense' },
  { key: 'gold', label: 'Gold', icon: '🥇', color: '#FBBF24', group: 'Investments & savings', type: 'expense' },

  // Lending / personal loans
  { key: 'lending_given', label: 'Money lent', icon: '🤲', color: '#F9A8D4', group: 'Lending / personal loans', type: 'expense' },
  { key: 'lending_received', label: 'Money received back', icon: '↩️', color: '#A78BFA', group: 'Lending / personal loans', type: 'expense' },
];

export const INCOME_CATEGORIES: Category[] = [
  { key: 'salary_1', label: 'Salary / income 1', icon: '💰', color: '#10B981', group: 'Income', type: 'income' },
  { key: 'salary_2', label: 'Salary / income 2', icon: '💰', color: '#34D399', group: 'Income', type: 'income' },
  { key: 'rent_income', label: 'Rent income', icon: '🏢', color: '#6EE7B7', group: 'Income', type: 'income' },
  { key: 'business_income', label: 'Business income', icon: '💼', color: '#FBBF24', group: 'Income', type: 'income' },
  { key: 'interest_returns', label: 'Interest / FD returns', icon: '📈', color: '#60A5FA', group: 'Income', type: 'income' },
  { key: 'gift_received', label: 'Gift received', icon: '🎁', color: '#C084FC', group: 'Income', type: 'income' },
  { key: 'other_income', label: 'Other income', icon: '✨', color: '#818CF8', group: 'Income', type: 'income' },
];

// The source of truth used to seed the server's categories table
// (server/src/db/seed-categories.ts) — the running app itself now reads
// categories from the server via context/CategoriesContext.tsx, since a
// user's custom categories only exist there, not in this static file.
export const ALL_CATEGORIES: Category[] = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
