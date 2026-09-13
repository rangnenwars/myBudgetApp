import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { Category, CategoryType } from '../constants/categories';
import { getCategories, addCategory as apiAddCategory, renameCategory as apiRenameCategory, deleteCategory as apiDeleteCategory } from '../utils/database';

interface CategoriesContextValue {
  categories: Category[];
  loading: boolean;
  getCategory: (key: string) => Category | undefined;
  groupCategories: (type: CategoryType) => { group: string; items: Category[] }[];
  addCategory: (input: { name: string; type: CategoryType }) => Promise<Category>;
  renameCategory: (key: string, name: string) => Promise<Category>;
  deleteCategory: (key: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const CategoriesContext = createContext<CategoriesContextValue | undefined>(undefined);

export const CategoriesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setCategories([]);
      return;
    }
    setLoading(true);
    try {
      setCategories(await getCategories());
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const getCategory = useCallback((key: string) => categories.find((c) => c.key === key), [categories]);

  // Groups preserve first-seen order — the server already returns system
  // categories in constants/categories.ts's group order, followed by the
  // caller's own custom ones (always group: 'Custom') in creation order.
  const groupCategories = useCallback(
    (type: CategoryType): { group: string; items: Category[] }[] => {
      const order: string[] = [];
      const groups: Record<string, Category[]> = {};
      for (const c of categories) {
        if (c.type !== type) continue;
        if (!groups[c.group]) {
          groups[c.group] = [];
          order.push(c.group);
        }
        groups[c.group].push(c);
      }
      return order.map((group) => ({ group, items: groups[group] }));
    },
    [categories]
  );

  const addCategory = useCallback(
    async (input: { name: string; type: CategoryType }) => {
      const created = await apiAddCategory(input);
      await refresh();
      return created;
    },
    [refresh]
  );

  const renameCategory = useCallback(
    async (key: string, name: string) => {
      const updated = await apiRenameCategory(key, name);
      await refresh();
      return updated;
    },
    [refresh]
  );

  const deleteCategory = useCallback(
    async (key: string) => {
      await apiDeleteCategory(key);
      await refresh();
    },
    [refresh]
  );

  const value: CategoriesContextValue = { categories, loading, getCategory, groupCategories, addCategory, renameCategory, deleteCategory, refresh };

  return <CategoriesContext.Provider value={value}>{children}</CategoriesContext.Provider>;
};

export const useCategories = (): CategoriesContextValue => {
  const ctx = useContext(CategoriesContext);
  if (!ctx) throw new Error('useCategories must be used within CategoriesProvider');
  return ctx;
};
