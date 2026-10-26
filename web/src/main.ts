import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';

const scene = new Scene();
scene.background = new Color(0x10131a);

const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(8, 8, 8);
camera.lookAt(0, 0, 0);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const ground = new Mesh(new PlaneGeometry(20, 20), new MeshStandardMaterial({ color: 0x4a7c59 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const box = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial({ color: 0xd9a066 }));
box.position.y = 1;
scene.add(box);

scene.add(new AmbientLight(0xffffff, 0.6));
const sun = new DirectionalLight(0xffffff, 1.5);
sun.position.set(5, 10, 3);
scene.add(sun);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => renderer.render(scene, camera));
