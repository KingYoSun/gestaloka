import { createFileRoute } from '@tanstack/react-router';
import { ExplorationPage } from '@/features/exploration/ExplorationPage';

export const Route = createFileRoute('/exploration')({
  component: ExplorationPage,
});