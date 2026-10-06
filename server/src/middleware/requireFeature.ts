import { Request, Response, NextFunction } from 'express';
import { featureNotAdded, hasFeature } from '../lib/features';
import { FeatureKey } from '../../../constants/features';

// Refuses the request with 403 FEATURE_NOT_ADDED unless staff have switched
// this optional feature on for the user (user_features). Runs after
// requireAuth. Checked on every request, like the role, so switching a
// feature off takes effect at once. The user's data is never touched.
export const requireFeature = (key: FeatureKey) => async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!(await hasFeature(req.userId!, key))) return next(featureNotAdded(key));
    next();
  } catch (err) {
    next(err);
  }
};
