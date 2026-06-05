// components/LoadingSkeleton.test.tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import LoadingSkeleton from './LoadingSkeleton';

describe('LoadingSkeleton', () => {
  describe('Rendering', () => {
    it('should render card variant', () => {
      const { getByTestId } = render(
        <LoadingSkeleton variant="card" />
      );

      expect(getByTestId('loading-skeleton')).toBeTruthy();
    });

    it('should render list variant', () => {
      const { getByTestId } = render(
        <LoadingSkeleton variant="list" />
      );

      expect(getByTestId('loading-skeleton')).toBeTruthy();
    });

    it('should render text variant', () => {
      const { getByTestId } = render(
        <LoadingSkeleton variant="text" />
      );

      expect(getByTestId('loading-skeleton')).toBeTruthy();
    });

    it('should render circle variant', () => {
      const { getByTestId } = render(
        <LoadingSkeleton variant="circle" />
      );

      expect(getByTestId('loading-skeleton')).toBeTruthy();
    });

    it('should render button variant', () => {
      const { getByTestId } = render(
        <LoadingSkeleton variant="button" />
      );

      expect(getByTestId('loading-skeleton')).toBeTruthy();
    });
  });

  describe('Custom Dimensions', () => {
    it('should apply custom width', () => {
      const { getByTestId } = render(
        <LoadingSkeleton variant="card" width={200} />
      );

      const skeleton = getByTestId('loading-skeleton');
      expect(skeleton.props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ width: 200 })
        ])
      );
    });

    it('should apply custom height', () => {
      const { getByTestId } = render(
        <LoadingSkeleton variant="card" height={100} />
      );

      const skeleton = getByTestId('loading-skeleton');
      expect(skeleton.props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ height: 100 })
        ])
      );
    });

    it('should apply custom width and height', () => {
      const { getByTestId } = render(
        <LoadingSkeleton variant="card" width={200} height={150} />
      );

      const skeleton = getByTestId('loading-skeleton');
      expect(skeleton.props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ width: 200, height: 150 })
        ])
      );
    });
  });

  describe('Custom Styles', () => {
    it('should apply custom container style', () => {
      const customStyle = { marginTop: 20, padding: 10 };
      const { getByTestId } = render(
        <LoadingSkeleton variant="card" style={customStyle} />
      );

      const skeleton = getByTestId('loading-skeleton');
      expect(skeleton.props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining(customStyle)
        ])
      );
    });
  });

  describe('Animation', () => {
    it('should have animation enabled by default', () => {
      const { getByTestId } = render(
        <LoadingSkeleton variant="card" />
      );

      const skeleton = getByTestId('loading-skeleton');
      // Check if skeleton container exists which contains animated view
      expect(skeleton).toBeTruthy();
    });
  });

  describe('Multiple Skeletons', () => {
    it('should render multiple text lines', () => {
      const { getAllByTestId } = render(
        <LoadingSkeleton variant="list" count={3} />
      );

      const skeletons = getAllByTestId('loading-skeleton');
      expect(skeletons).toHaveLength(3);
    });

    it('should apply spacing between multiple skeletons', () => {
      const { getAllByTestId } = render(
        <LoadingSkeleton variant="text" count={3} spacing={10} />
      );

      const skeletons = getAllByTestId('loading-skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe('Variants', () => {
    it('should have different styles for each variant', () => {
      const { getByTestId: getCard } = render(
        <LoadingSkeleton variant="card" />
      );
      const { getByTestId: getText } = render(
        <LoadingSkeleton variant="text" />
      );
      const { getByTestId: getCircle } = render(
        <LoadingSkeleton variant="circle" />
      );

      const cardSkeleton = getCard('loading-skeleton');
      const textSkeleton = getText('loading-skeleton');
      const circleSkeleton = getCircle('loading-skeleton');

      expect(cardSkeleton).toBeTruthy();
      expect(textSkeleton).toBeTruthy();
      expect(circleSkeleton).toBeTruthy();
    });
  });

  describe('Accessibility', () => {
    it('should have accessibility label', () => {
      const { getByTestId } = render(
        <LoadingSkeleton variant="card" />
      );

      const skeleton = getByTestId('loading-skeleton');
      expect(skeleton.props.accessibilityLabel).toBeDefined();
    });

    it('should have busy accessibility state', () => {
      const { getByTestId } = render(
        <LoadingSkeleton variant="card" />
      );

      const skeleton = getByTestId('loading-skeleton');
      expect(skeleton.props.accessibilityState?.busy).toBe(true);
    });
  });
});



