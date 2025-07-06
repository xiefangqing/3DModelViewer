import * as THREE from 'three';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';

// --- 辅助函数 ---

/**
 * 从 FileList 创建一个文件名到 File 对象的文件映射。
 * 这对于处理多文件模型（如 OBJ + MTL）至关重要，加载器可以通过文件名找到对应的文件数据。
 * @param files - 用户拖入的文件列表。
 * @returns 一个形如 { 'model.obj': File, 'model.mtl': File } 的映射表。
 */
function createFilesMap(files: File[]): { [key: string]: File } {
  const map: { [key: string]: File } = {};
  for (const file of files) {
    map[file.name] = file;
  }
  return map;
}

/**
 * 从 DataTransferItemList 中异步、递归地提取所有文件。
 * 现代浏览器拖拽文件夹时，会使用此 API。此函数可以深入文件夹内部，获取所有文件。
 * @param items - 拖拽事件中的 DataTransferItemList 对象。
 * @returns 一个 Promise，成功后返回包含 files 数组和 filesMap 的对象。
 */
function getFilesFromItemList(
  items: DataTransferItemList
): Promise<{ files: File[]; filesMap: { [key: string]: File } }> {
  return new Promise((resolve) => {
    let itemsCount = 0;
    let itemsTotal = 0;
    const files: File[] = [];
    const filesMap: { [key: string]: File } = {};

    const onEntryHandled = () => {
      itemsCount++;
      if (itemsCount === itemsTotal) {
        resolve({ files, filesMap });
      }
    };

    const handleEntry = (entry: any) => {
      itemsTotal++;
      if (entry.isDirectory) {
        const reader = entry.createReader();
        reader.readEntries((entries: any[]) => {
          for (const subEntry of entries) {
            handleEntry(subEntry);
          }
          onEntryHandled();
        });
      } else if (entry.isFile) {
        entry.file((file: File) => {
          files.push(file);
          // 使用 fullPath 作为 key，可以保留文件夹结构，对于某些依赖相对路径的模型格式很重要
          filesMap[entry.fullPath.slice(1)] = file;
          onEntryHandled();
        });
      } else {
        // 如果不是文件或目录，也需要减少计数器
        onEntryHandled();
      }
    };

    for (const item of items) {
      if (item.kind === 'file') {
        handleEntry(item.webkitGetAsEntry());
      }
    }
  });
}

/**
 * 创建并配置一个功能完备的 GLTFLoader。
 * GLTF/GLB 是现代 Web 3D 的核心格式，它可能依赖 Draco、KTX2、Meshopt 等多种压缩技术。
 * 此函数负责按需加载这些解码器并配置好 GLTFLoader。
 * @param manager - THREE.LoadingManager 实例，用于协调资源加载。
 * @returns 配置好的 GLTFLoader 实例。
 */
async function createGLTFLoader(manager?: THREE.LoadingManager) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
  const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
  const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');

  // Draco 解码器，用于解压被 Draco 压缩的几何体
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/'); // 使用 Google 官方的 CDN

  // KTX2 解码器，用于解压 KTX2 格式的纹理
  const ktx2Loader = new KTX2Loader(manager);
  ktx2Loader.setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/basis/'); // 使用公共 CDN

  const loader = new GLTFLoader(manager);
  loader.setDRACOLoader(dracoLoader);
  loader.setKTX2Loader(ktx2Loader);
  loader.setMeshoptDecoder(MeshoptDecoder); // Meshopt 解码器

  return loader;
}

// --- 核心加载逻辑 ---

/**
 * 根据文件扩展名，选择合适的加载器来加载单个文件。
 * 这是整个模块的核心，通过一个 switch 语句分发加载任务。
 * @param file - 要加载的 File 对象。
 * @param manager - THREE.LoadingManager 实例。
 * @returns 一个 Promise，成功后返回加载并解析好的 THREE.Object3D 对象。
 */
async function loadFile(file: File, manager: THREE.LoadingManager): Promise<THREE.Object3D> {
  const filename = file.name;
  const extension = filename.split('.').pop()?.toLowerCase() || '';

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener(
      'load',
      async (event) => {
        const contents = event.target?.result;
        if (!contents) {
          reject(new Error('读取文件失败 (File read failed)'));
          return;
        }

        try {
          switch (extension) {
            case 'fbx': {
              const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
              const loader = new FBXLoader(manager);
              const object = loader.parse(contents as ArrayBuffer, '');
              object.name = filename;
              resolve(object);
              break;
            }

            case 'glb': {
              const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
              const loader = await createGLTFLoader(manager);
              loader.parse(
                contents as ArrayBuffer,
                '',
                (result) => {
                  const scene = result.scene;
                  scene.name = filename;
                  scene.animations.push(...result.animations);
                  loader.dracoLoader?.dispose();
                  loader.ktx2Loader?.dispose();
                  resolve(scene);
                },
                reject
              );
              break;
            }

            case 'gltf': {
              const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
              const loader = await createGLTFLoader(manager);
              loader.parse(
                contents as string,
                '',
                (result) => {
                  const scene = result.scene;
                  scene.name = filename;
                  scene.animations.push(...result.animations);
                  loader.dracoLoader?.dispose();
                  loader.ktx2Loader?.dispose();
                  resolve(scene);
                },
                reject
              );
              break;
            }

            case 'obj': {
              const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
              const object = new OBJLoader(manager).parse(contents as string);
              object.name = filename;
              resolve(object);
              break;
            }

            case 'ply': {
              const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js');
              const geometry = new PLYLoader().parse(contents as ArrayBuffer);
              geometry.computeVertexNormals(); // 计算顶点法线，确保光照正确
              let object: THREE.Object3D;
              // PLY 文件可能只包含点云，也可能包含面。需要判断。
              if (geometry.index !== null) {
                // 如果有索引，说明是网格模型
                const material = new THREE.MeshStandardMaterial({
                  vertexColors: geometry.hasAttribute('color'), // 启用顶点颜色
                  side: THREE.DoubleSide, // 启用双面渲染，解决背面透明问题
                });
                object = new THREE.Mesh(geometry, material);
              } else {
                // 否则是点云模型
                const material = new THREE.PointsMaterial({ size: 0.01 });
                material.vertexColors = geometry.hasAttribute('color'); // 如果点数据包含颜色，则使用顶点色
                object = new THREE.Points(geometry, material);
              }
              object.name = filename;
              resolve(object);
              break;
            }

            case 'stl': {
              const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
              const geometry = new STLLoader().parse(contents as ArrayBuffer);
              const material = new THREE.MeshStandardMaterial();
              const mesh = new THREE.Mesh(geometry, material);
              mesh.name = filename;
              resolve(mesh);
              break;
            }

            case 'zip': {
              const zip = unzipSync(new Uint8Array(contents as ArrayBuffer));
              const zipManager = new THREE.LoadingManager();
              zipManager.setURLModifier((url) => {
                const file = zip[url];
                if (file) {
                  const blob = new Blob([file.buffer], { type: 'application/octet-stream' });
                  return URL.createObjectURL(blob);
                }
                return url;
              });

              const supportedExtensions = ['gltf', 'glb', 'fbx', 'obj', 'stl', 'ply'];
              for (const path in zip) {
                const fileData = zip[path];
                const ext = path.split('.').pop()?.toLowerCase() || '';
                if (supportedExtensions.includes(ext)) {
                  const blob = new Blob([fileData.buffer]);
                  const innerFile = new File([blob], path);
                  // 递归调用 loadFile 来处理 zip 包内部的模型文件
                  resolve(await loadFile(innerFile, zipManager));
                  return; // 找到第一个可加载模型后立即返回
                }
              }
              reject(new Error('在 ZIP 包中未找到支持的模型文件 (No supported model found in ZIP)'));
              break;
            }

            default:
              // 这个 reject 理论上不会被触发，因为我们在主函数中已经筛选过一次了
              reject(new Error(`不支持的文件格式 (Unsupported file format): .${extension}`));
              break;
          }
        } catch (error) {
          reject(error);
        }
      },
      false
    );

    reader.addEventListener('error', (error) => reject(error));

    // 根据不同文件格式，选择不同的文件读取方式
    if (['gltf', 'obj'].includes(extension)) {
      reader.readAsText(file); // 这些格式是基于文本的
    } else {
      reader.readAsArrayBuffer(file); // 其他大部分是二进制格式
    }
  });
}

// --- 主导出函数 ---

/**
 * 对加载的模型进行归一化处理，使其尺寸适中并居中显示。
 * @param object - 要归一化的 THREE.Object3D 对象。
 */
function normalizeModel(object: THREE.Object3D) {
  // 1. 计算模型的包围盒
  const box = new THREE.Box3().setFromObject(object);

  // 2. 计算包围盒的尺寸和中心点
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  // 3. 计算缩放比例
  // 找到最长的边
  const maxSize = Math.max(size.x, size.y, size.z);
  // 设置一个期望的尺寸，例如 10 个单位
  const desiredSize = 10;
  const scale = desiredSize / maxSize;

  // 4. 应用变换
  // 首先将模型中心移动到原点，然后再进行缩放
  object.position.sub(center);
  object.scale.set(scale, scale, scale);

  // 5. 重新计算中心点并移动到原点（确保精确）
  const newBox = new THREE.Box3().setFromObject(object);
  const newCenter = new THREE.Vector3();
  newBox.getCenter(newCenter);
  object.position.sub(newCenter);

  console.log(`模型已归一化：缩放比例=${scale.toFixed(2)}，中心点已重置。`);
}

/**
 * 清理场景中所有可被视为“模型”的旧对象。
 * 在加载新模型前调用此函数，可以防止新旧模型重叠。
 * @param scene - THREE.Scene 实例。
 */
function clearScene(scene: THREE.Scene) {
  const objectsToRemove: THREE.Object3D[] = [];
  scene.children.forEach((child) => {
    const anyChild = child as any;
    // 通过检查类型来保留场景中的相机、光照和坐标轴等辅助对象
    if (!(anyChild.isCamera || anyChild.isLight || anyChild.isAxesHelper)) {
      objectsToRemove.push(child);
    }
  });
  objectsToRemove.forEach((child) => scene.remove(child));
}

/**
 * 加载用户拖拽的模型文件（或包含模型的ZIP包）并将其添加到场景中。
 * 这是暴露给外部 Vue 组件的唯一接口。
 * @param droppedItems - 用户拖拽事件中的 DataTransferItemList 或 FileList。
 * @param scene - 要将模型添加到的 THREE.Scene 实例。
 */
export async function loadModel(droppedItems: DataTransferItemList | FileList, scene: THREE.Scene) {
  let files: File[];
  let filesMap: { [key: string]: File };

  // 1. 从拖拽事件中提取文件列表和文件映射
  if (droppedItems instanceof DataTransferItemList) {
    ({ files, filesMap } = await getFilesFromItemList(droppedItems));
  } else {
    files = Array.from(droppedItems);
    filesMap = createFilesMap(files);
  }

  if (files.length === 0) return;

  // 2. 创建 LoadingManager 来处理多文件依赖
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    // 当加载器（如OBJLoader请求MTL文件）请求一个资源时，
    // 拦截请求，并在我们已有的文件映射中查找。
    const file = filesMap[url.replace(/^(\.?\/)/, '')];
    if (file) {
      // 如果找到，为其创建一个临时的本地 URL
      return URL.createObjectURL(file);
    }
    // 如果没找到，则按原样返回 URL（例如，去网络请求）
    return url;
  });
  manager.addHandler(/\.tga$/i, new TGALoader()); // 为 TGA 纹理格式注册加载器

  // 3. 确定要加载的主文件
  const supportedExtensions = ['stl', 'obj', 'ply', 'gltf', 'glb', 'fbx', 'zip'];
  const primaryFile = files.find((f) => supportedExtensions.includes(f.name.split('.').pop()?.toLowerCase() || ''));

  // 4. 如果找到了支持的主文件，则开始加载
  if (primaryFile) {
    try {
      console.log(`开始加载 (Loading) ${primaryFile.name}...`);
      const object = await loadFile(primaryFile, manager);

      // 5. 对模型进行归一化处理
      normalizeModel(object);

      // 6. 加载成功后，清空旧模型并添加新模型
      clearScene(scene);
      scene.add(object);

      console.log('模型加载成功 (Model loaded successfully)!');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('模型加载失败 (Error loading model):', errorMessage);
      alert(`模型加载失败 (Failed to load model): ${errorMessage}`);
    }
  } else {
    alert(
      '未找到支持的模型文件 (No supported model file found). 支持的格式 (Supported formats are): ' +
        supportedExtensions.join(', ')
    );
  }
}
