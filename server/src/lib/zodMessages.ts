import { z } from 'zod';

// Plain-language wording for validation errors the schemas don't word themselves.
// The app shows the server's message to the user, and zod 4's built-in text
// ("Invalid input: expected string, received undefined") is for developers.
// A message written on a schema (.min(8, '…')) always wins; this only fills the gaps.
z.config({
  customError: (issue) => {
    switch (issue.code) {
      case 'invalid_type':
        return issue.input === undefined ? 'This is required.' : 'That is not the right kind of value.';
      case 'invalid_value':
        return 'That is not one of the allowed choices.';
      case 'too_small':
        if (issue.origin === 'string') return Number(issue.minimum) <= 1 ? "This can't be empty." : `Use at least ${issue.minimum} characters.`;
        if (issue.origin === 'array') return `Add at least ${issue.minimum} ${Number(issue.minimum) === 1 ? 'item' : 'items'}.`;
        return issue.inclusive === false ? `That must be more than ${issue.minimum}.` : `That is too small (the minimum is ${issue.minimum}).`;
      case 'too_big':
        if (issue.origin === 'string') return `Keep it to ${issue.maximum} characters or fewer.`;
        if (issue.origin === 'array') return `Add no more than ${issue.maximum} items.`;
        return `That is too large (the maximum is ${issue.maximum}).`;
      default:
        return undefined;
    }
  },
});
