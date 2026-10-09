export default { test: { include: ['tests/**/*.test.mjs'], environment: process.env.SPIKE_ENV || 'jsdom' } };
