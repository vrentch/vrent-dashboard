import {
  Newspaper,
  Globe,
  Landmark,
  Briefcase,
  LineChart,
  Cpu,
  FlaskConical,
  HeartPulse,
  Trophy,
  Clapperboard,
  Leaf,
  Building2,
  Bitcoin,
  Tag,
  type LucideProps,
} from "lucide-react";
import type { ComponentType } from "react";

const MAP: Record<string, ComponentType<LucideProps>> = {
  Newspaper,
  Globe,
  Landmark,
  Briefcase,
  LineChart,
  Cpu,
  FlaskConical,
  HeartPulse,
  Trophy,
  Clapperboard,
  Leaf,
  Building2,
  Bitcoin,
};

export default function TopicIcon({ name, ...props }: { name: string } & LucideProps) {
  const Cmp = MAP[name] || Tag;
  return <Cmp {...props} />;
}
