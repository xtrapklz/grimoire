import { createApp } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import App from "./App.vue";
import HomeView from "./views/HomeView.vue";
import StageView from "./views/StageView.vue";
import PlayerView from "./views/PlayerView.vue";
import DevView from "./views/DevView.vue";
import "./style.css";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: HomeView },
    { path: "/stage", component: StageView },
    { path: "/stage/:code", component: StageView, props: true },
    { path: "/play/:code?", component: PlayerView, props: true },
    { path: "/dev/:code", component: DevView, props: true },
  ],
});

createApp(App).use(router).mount("#app");
