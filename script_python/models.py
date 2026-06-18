"""
models.py - All Pydantic request/response models
"""

from typing import Optional, List
from pydantic import BaseModel


class SaveRequest(BaseModel):
    url: str
    title: str = ""
    vault: str = "default"
    tags: List[str] = []
    archive: bool = False
    screenshot: bool = True
    notes: str = ""
    folder_id: Optional[str] = None
    favicon_url: Optional[str] = None
    screenshot_data: Optional[str] = None
    html_data: Optional[str] = None


class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[str] = None
    vault: str = "default"


class FolderRename(BaseModel):
    name: str


class FolderMove(BaseModel):
    parent_id: Optional[str] = None


class BookmarkMove(BaseModel):
    folder_id: Optional[str] = None


class BulkMoveRequest(BaseModel):
    ids: List[str]
    folder_id: Optional[str] = None


class BulkCopyRequest(BaseModel):
    ids: List[str]
    folder_id: Optional[str] = None
    vault: Optional[str] = None


class BulkTagRequest(BaseModel):
    ids: List[str]
    add: List[str] = []
    remove: List[str] = []


class BookmarkTagPatch(BaseModel):
    tags: List[str]


class BookmarkNotesPatch(BaseModel):
    notes: str


class FetchMetaRequest(BaseModel):
    url: str
    archive: bool = False


class BookmarkFetchRequest(BaseModel):
    archive: bool = False


class BulkFetchRequest(BaseModel):
    ids: List[str]
    archive: bool = False


class OrderItem(BaseModel):
    item_id: str
    item_type: str  # 'bookmark' | 'folder'


class SetFolderOrderRequest(BaseModel):
    folder_id: Optional[str] = None
    items: List[OrderItem]


class BulkFolderMoveRequest(BaseModel):
    ids: List[str]
    target_parent_id: Optional[str] = None


class BulkDeleteRequest(BaseModel):
    bookmark_ids: list[str]
    folder_ids: list[str]


class BookmarkUpdate(BaseModel):
    title: str
    url: str
    notes: str
    tags: list[str] = []


class JobControl(BaseModel):
    action: str  # "pause", "resume", "cancel", "dismiss"


class FetchRequest(BaseModel):
    bookmark_ids: list[str]
    fetch_screenshot: bool
    fetch_archive: bool


class BulkImportItem(BaseModel):
    type: str  # 'folder' or 'bookmark'
    id: Optional[str] = None
    parent_id: Optional[str] = None
    folder_id: Optional[str] = None
    name: Optional[str] = None
    title: Optional[str] = None
    url: Optional[str] = None
    archive: Optional[bool] = False


class BulkImportRequest(BaseModel):
    vault: str
    items: list[BulkImportItem]

class BulkMoveItemsRequest(BaseModel):
    bookmark_ids: list[str]
    folder_ids: list[str]
    target_folder_id: Optional[str] = None


class BulkCopyItemsRequest(BaseModel):
    bookmark_ids: list[str]
    folder_ids: list[str]
    target_folder_id: Optional[str] = None
    target_vault: Optional[str] = None



class TrashRestoreRequest(BaseModel):
    trash_ids: list[str]

class TrashPurgeRequest(BaseModel):
    trash_ids: list[str]




class VaultSetPin(BaseModel):
    pin: Optional[str] = None  # None = remove PIN

class VaultUnlockRequest(BaseModel):
    pin: str
