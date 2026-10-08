// Inline projects that inherit the root config (`extends: true`), like ariakit.
export default {
  test: {
    projects: [
      { extends: true, test: { name: 'dom', environment: 'jsdom', include: ['**/*.test.mjs'] } },
    ],
  },
};
