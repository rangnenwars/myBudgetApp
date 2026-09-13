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
  { key: 'maid_car_wash', label: 'Maid & car wash', icon: '🧹', color: '#34D399', group: 'Household', type: 'expense' },
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
  { key: 'rashmi_darsh', label: 'Rashmi & Darsh (family)', icon: '👨‍👩‍👧', color: '#C084FC', group: 'Family & education', type: 'expense' },
  { key: 'rashmi_contribution_exp', label: 'Rashmi contribution', icon: '👩', color: '#A78BFA', group: 'Family & education', type: 'expense' },

  // Loans & EMIs
  { key: 'home_loan_1', label: 'Home loan 1 EMI', icon: '🏡', color: '#60A5FA', group: 'Loans & EMIs', type: 'expense' },
  { key: 'home_loan_2', label: 'Home loan 2 EMI', icon: '🏘️', color: '#3B82F6', group: 'Loans & EMIs', type: 'expense' },
  { key: 'home_loan_3_4', label: 'Home loan 3 & 4 EMI', icon: '🏗️', color: '#2563EB', group: 'Loans & EMIs', type: 'expense' },
  { key: 'personal_car_loan', label: 'Personal / car loan EMI', icon: '🚗', color: '#818CF8', group: 'Loans & EMIs', type: 'expense' },
  { key: 'gold_loan', label: 'Gold loan', icon: '🥇', color: '#FBBF24', group: 'Loans & EMIs', type: 'expense' },
  { key: 'external_emis', label: 'External EMIs', icon: '💳', color: '#FB923C', group: 'Loans & EMIs', type: 'expense' },

  // Credit cards
  { key: 'hdfc_cc', label: 'HDFC credit card', icon: '💳', color: '#F87171', group: 'Credit cards', type: 'expense' },
  { key: 'sbi_cc', label: 'SBI credit card', icon: '💳', color: '#FBBF24', group: 'Credit cards', type: 'expense' },
  { key: 'kotak_cc', label: 'Kotak credit card', icon: '💳', color: '#34D399', group: 'Credit cards', type: 'expense' },
  { key: 'icici_cc', label: 'ICICI credit card', icon: '💳', color: '#60A5FA', group: 'Credit cards', type: 'expense' },

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
  { key: 'mandawa_kinwat_maintenance', label: 'Mandawa / Kinwat maintenance', icon: '🏚️', color: '#A3A3A3', group: 'Property & farming', type: 'expense' },
  { key: 'rs605_expenses', label: 'RS-605 expenses', icon: '🏠', color: '#D4D4D4', group: 'Property & farming', type: 'expense' },

  // Investments & savings
  { key: 'mutual_funds', label: 'Mutual funds (SIP)', icon: '📈', color: '#10B981', group: 'Investments & savings', type: 'expense' },
  { key: 'fixed_deposit', label: 'Fixed deposit (FD)', icon: '🏦', color: '#34D399', group: 'Investments & savings', type: 'expense' },
  { key: 'bonds', label: 'Bonds', icon: '📊', color: '#6EE7B7', group: 'Investments & savings', type: 'expense' },
  { key: 'gold', label: 'Gold', icon: '🥇', color: '#FBBF24', group: 'Investments & savings', type: 'expense' },
  { key: 'hyd_bc', label: 'Hyd BC (chit fund)', icon: '🤝', color: '#FCD34D', group: 'Investments & savings', type: 'expense' },
  { key: 'self_bc', label: 'Self BC', icon: '🤝', color: '#F59E0B', group: 'Investments & savings', type: 'expense' },
  { key: 'kinwat_bc', label: 'Kinwat BC', icon: '🤝', color: '#D97706', group: 'Investments & savings', type: 'expense' },
  { key: 'dalappu', label: 'Dalappu', icon: '💰', color: '#9CA3AF', group: 'Investments & savings', type: 'expense' },

  // Lending / personal loans
  { key: 'lending_given', label: 'Given to: Aanna, Nananna, Amit, Girish Anna, Roony, Chetan Bawa, Lalit Deshmukh, Ramukaka, Shreyas, Sairaj, Raju Kokkerwar, Manish, Bolchetti Sasur, Gaju Bamardi, Thotawar', icon: '🤲', color: '#F9A8D4', group: 'Lending / personal loans', type: 'expense' },
  { key: 'lending_received', label: 'Received from / repaid', icon: '↩️', color: '#A78BFA', group: 'Lending / personal loans', type: 'expense' },
];

export const INCOME_CATEGORIES: Category[] = [
  { key: 'salary_1', label: 'Salary / income 1', icon: '💰', color: '#10B981', group: 'Income', type: 'income' },
  { key: 'salary_2', label: 'Salary / income 2', icon: '💰', color: '#34D399', group: 'Income', type: 'income' },
  { key: 'rent_income', label: 'Rent income', icon: '🏢', color: '#6EE7B7', group: 'Income', type: 'income' },
  { key: 'business_income', label: 'Business income', icon: '💼', color: '#FBBF24', group: 'Income', type: 'income' },
  { key: 'interest_returns', label: 'Interest / FD returns', icon: '📈', color: '#60A5FA', group: 'Income', type: 'income' },
  { key: 'gift_received', label: 'Gift received', icon: '🎁', color: '#C084FC', group: 'Income', type: 'income' },
  { key: 'rashmi_contribution_inc', label: 'Rashmi contribution', icon: '👩', color: '#A78BFA', group: 'Income', type: 'income' },
  { key: 'kunal', label: 'Kunal', icon: '💼', color: '#818CF8', group: 'Income', type: 'income' },
  { key: 'gajanan_b', label: 'Gajanan B', icon: '💼', color: '#818CF8', group: 'Income', type: 'income' },
  { key: 'thotawar_inc', label: 'Thotawar', icon: '💼', color: '#818CF8', group: 'Income', type: 'income' },
  { key: 'gaju_sasur', label: 'Gaju Sasur', icon: '💼', color: '#818CF8', group: 'Income', type: 'income' },
  { key: 'other_income', label: 'Other income', icon: '✨', color: '#818CF8', group: 'Income', type: 'income' },
];

// The source of truth used to seed the server's categories table
// (server/src/db/seed-categories.ts) — the running app itself now reads
// categories from the server via context/CategoriesContext.tsx, since a
// user's custom categories only exist there, not in this static file.
export const ALL_CATEGORIES: Category[] = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
