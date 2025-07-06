<template>
  <div ref="container" class="model-container"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadModel } from './ModelLoader';

// 用于挂载 canvas 的 DOM 容器
const container = ref<HTMLDivElement | null>(null);

let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let animationFrameId: number;

// 初始化 Three.js 场景
const initThree = () => {
  if (!container.value) return;

  // 1. 创建场景
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  // 2. 创建相机
  camera = new THREE.PerspectiveCamera(75, container.value.clientWidth / container.value.clientHeight, 0.1, 100);
  camera.position.set(5, 5, 10); // 设置相机位置

  // 3. 创建渲染器
  renderer = new THREE.WebGLRenderer({ antialias: true }); // 开启抗锯齿
  renderer.setSize(container.value.clientWidth, container.value.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio); // 适配高分屏
  container.value.appendChild(renderer.domElement);

  // 4. 添加光照
  // 环境光，提供基础亮度
  const ambientLight = new THREE.AmbientLight(0xffffff, 1);
  scene.add(ambientLight);

  // // 主光源（右上方）
  const mainLight = new THREE.DirectionalLight(0xffffff, 3);
  mainLight.position.set(5, 10, 7.5);
  scene.add(mainLight);

  // // 辅光（左下方），用于补足暗部细节
  const fillLight = new THREE.DirectionalLight(0xffffff, 3);
  fillLight.position.set(-5, -10, -7.5);
  scene.add(fillLight);

  // 5. 创建轨道控制器
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; // 启用阻尼效果，使旋转更平滑
  controls.dampingFactor = 0.05;

  // 7. 启动渲染循环
  animate();

  // 8. 监听窗口大小变化
  window.addEventListener('resize', onWindowResize);
};

// 渲染循环
const animate = () => {
  animationFrameId = requestAnimationFrame(animate);
  controls.update(); // 更新控制器
  renderer.render(scene, camera);
};

// 处理窗口大小变化
const onWindowResize = () => {
  if (container.value) {
    camera.aspect = container.value.clientWidth / container.value.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.value.clientWidth, container.value.clientHeight);
  }
};

// --- 拖拽事件处理 ---

const handleDragOver = (event: DragEvent) => {
  event.preventDefault();
  event.dataTransfer!.dropEffect = 'copy';
};

const handleDrop = (event: DragEvent) => {
  event.preventDefault();
  const items = event.dataTransfer?.items;
  if (!items || !scene) return;

  loadModel(items, scene);
};

// Vue 生命周期钩子
onMounted(() => {
  initThree();
  if (container.value) {
    container.value.addEventListener('dragover', handleDragOver);
    container.value.addEventListener('drop', handleDrop);
  }
});

onUnmounted(() => {
  // 清理资源
  window.removeEventListener('resize', onWindowResize);
  if (container.value) {
    container.value.removeEventListener('dragover', handleDragOver);
    container.value.removeEventListener('drop', handleDrop);
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  if (renderer) {
    renderer.dispose();
  }
  // 其他需要清理的资源...
});
</script>

<style scoped>
.model-container {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
</style>
