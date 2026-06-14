// src/pages/Dashboard.jsx
import MainArea from '../components/MainArea';
import BulkBar from '../components/BulkBar';
import DetailPanel from '../components/DetailPanel';
import NewFolderModal from '../components/NewFolderModal';
import NewBookmarkModal from '../components/NewBookmarkModal';
import BulkFetchModal from '../components/BulkFetchModal';

export default function Dashboard() {
  return (
    <>
      <MainArea />
      <BulkBar />
      <DetailPanel />
      <NewFolderModal />
      <NewBookmarkModal />
      <BulkFetchModal />
    </>
  );
}