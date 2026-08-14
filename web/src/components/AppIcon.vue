<template>
  <component :is="iconComponent" aria-hidden="true" :size="size" :weight="weight" />
</template>

<script setup>
import { computed } from 'vue';
import {
  PhArrowLeft,
  PhBell,
  PhCalendarBlank,
  PhCalendarCheck,
  PhChartBar,
  PhChartLineUp,
  PhChatCircleText,
  PhCheckCircle,
  PhCompass,
  PhCookie,
  PhCurrencyCircleDollar,
  PhDotsThreeCircle,
  PhFire,
  PhGearSix,
  PhHeart,
  PhHouse,
  PhIdentificationCard,
  PhKey,
  PhListChecks,
  PhMegaphone,
  PhNotePencil,
  PhPencilSimpleLine,
  PhRobot,
  PhRocketLaunch,
  PhShieldCheck,
  PhSignOut,
  PhSparkle,
  PhStar,
  PhThumbsUp,
  PhToolbox,
  PhUploadSimple,
  PhUser,
  PhUsers,
  PhWrench
} from '@phosphor-icons/vue';

const props = defineProps({
  name: { type: String, default: 'sparkle' },
  size: { type: [Number, String], default: 22 },
  weight: { type: String, default: 'regular' }
});

const icons = {
  back: PhArrowLeft,
  home: PhHouse,
  calendar: PhCalendarBlank,
  'calendar-check': PhCalendarCheck,
  tasks: PhListChecks,
  settings: PhGearSix,
  user: PhUser,
  users: PhUsers,
  more: PhDotsThreeCircle,
  compass: PhCompass,
  admin: PhChartBar,
  chart: PhChartLineUp,
  key: PhKey,
  history: PhNotePencil,
  tools: PhToolbox,
  wrench: PhWrench,
  fire: PhFire,
  points: PhCurrencyCircleDollar,
  identity: PhIdentificationCard,
  comment: PhChatCircleText,
  favorite: PhHeart,
  like: PhThumbsUp,
  baoliao: PhMegaphone,
  robot: PhRobot,
  notify: PhBell,
  update: PhUploadSimple,
  cookie: PhCookie,
  shield: PhShieldCheck,
  'sign-out': PhSignOut,
  check: PhCheckCircle,
  star: PhStar,
  rocket: PhRocketLaunch,
  edit: PhPencilSimpleLine,
  sparkle: PhSparkle
};

const iconComponent = computed(() => icons[props.name] || PhSparkle);
</script>
